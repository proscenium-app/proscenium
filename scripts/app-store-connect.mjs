// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The App Store Connect API, as the Mac App Store channel uses it
 * (docs/engineering/release-engineering.md#REL-56): each release's version
 * made, its build chosen, its listing, What's New and screenshots written,
 * and its submission for review; App Review's answer read; and the Mac App
 * Store provisioning profile made again whenever it would lapse.
 *
 * Every flow takes `api(method, path, body)`, which answers `{ status, json }`,
 * and for files `put(url, headers, bytes, method)`. Nothing here reaches the
 * network on its own: `apiOf()` and `putOf()` are the real ones, with the
 * release keychain's key, so every flow is tested against a played App Store
 * Connect. Each first looks for what an earlier attempt made, so each can run
 * again.
 *
 * What the API does not reach, and stays a person's: making the app's record
 * (New App), its App Privacy answers, age rating and price, the certificates,
 * and App Review's reasons for a rejection, which only App Store Connect's
 * Resolution Center shows.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";

export const API = "https://api.appstoreconnect.apple.com";

/** A JSON Web Token App Store Connect accepts for twenty minutes (ES256, its audience). */
export function ascToken({ keyId, issuer, p8, now = Date.now() }) {
  const b64 = (v) =>
    Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  const iat = Math.floor(now / 1000);
  const body = `${b64({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64({
    iss: issuer,
    iat,
    exp: iat + 20 * 60,
    aud: "appstoreconnect-v1",
  })}`;
  const signature = sign("sha256", Buffer.from(body), {
    key: createPrivateKey(p8),
    dsaEncoding: "ieee-p1363",
  });
  return `${body}.${signature.toString("base64url")}`;
}

/** The API, with `key` (`{ keyId, issuer, p8 }`): a token made for each call. */
export function apiOf(key, { fetcher = fetch } = {}) {
  return async (method, path, body) => {
    const r = await fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${ascToken(key)}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: r.status, json };
  };
}

/** A part of a file, to the address App Store Connect reserved for it. */
export function putOf({ fetcher = fetch } = {}) {
  return async (url, headers, bytes, method = "PUT") => {
    const r = await fetcher(url, {
      method,
      headers,
      body: bytes,
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`a screenshot's part was refused: ${r.status}`);
  };
}

const q = encodeURIComponent;

/** The answer's JSON, or why App Store Connect refused, with `what` was asked. */
function ok(r, what) {
  if (r.status >= 200 && r.status < 300) return r.json;
  // Apple names what stands in the way under each error's associatedErrors:
  // "cannot be reviewed" alone says nothing a person can act on.
  const said = (r.json?.errors ?? [])
    .flatMap((e) => [
      e.detail ?? e.title,
      ...Object.values(e.meta?.associatedErrors ?? {})
        .flat()
        .map((a) => a?.detail ?? a?.title)
        .filter(Boolean),
    ])
    .join("; ");
  const e = new Error(`${what}: App Store Connect answered ${r.status}${said ? `: ${said}` : ""}`);
  e.status = r.status;
  throw e;
}

/** The app's record, or a refusal that says it is the maintainer's to make. */
export async function appOf(api, identifier) {
  const app = ok(await api("GET", `/v1/apps?filter[bundleId]=${q(identifier)}`), "the app")
    .data?.[0];
  if (!app)
    throw new Error(
      `App Store Connect has no app for ${identifier}: its record is the maintainer's to make (docs/engineering/release-engineering.md#SHIP-D113)`,
    );
  return app;
}

/** Where a version's page is in App Store Connect, for a person to read. */
export const versionPage = (appId) =>
  `https://appstoreconnect.apple.com/apps/${appId}/distribution/macos/version/inflight`;

// --- What's New ---------------------------------------------------------------------------

/**
 * A list item, or a paragraph, a store's copy leaves out: the download's
 * updater and its tracks, and the other platform. A store updates its copy
 * itself, and a listing names no other platform: the Mac App Store's no
 * Windows, the Microsoft Store's no Mac.
 */
const THE_DOWNLOADS =
  /\bupdater\b|Settings › Updates|\bupdate[sd]? (?:itself|automatically|by itself)\b|\b(?:Alpha|Beta|Stable)\b|\btest version\b|\bproscenium\.ink\/download/i;
const NOT_THE_STORES = {
  mac: /\bWindows\b/i,
  windows:
    /\bmacOS\b|\bMac App Store\b|\b(?:the|a|your|this) Mac\b|\bFinder\b|\bHomebrew\b|\bRosetta\b|\bApple silicon\b|\bIntel\b|\bVoiceOver\b/i,
};
/** What's New's limit in App Store Connect; What's new in this version's in Partner Center. */
const NOTES_LIMITS = { mac: 4000, windows: 1500 };

/**
 * A release's public notes (its changelog section) as a store's What's
 * New: plain text, a paragraph or an item a line, without what is not the
 * store's, within its limit (the Mac App Store's 4000 characters, the
 * Microsoft Store's 1500, cut there at a whole line). Null when there are no
 * notes at all; a release whose every line was the download's says only that
 * it was mended.
 */
export function storeNotes(markdown, { store = "mac" } = {}) {
  if (!NOT_THE_STORES[store]) throw new Error(`no store ${store}`);
  const notTheStore = (text) => THE_DOWNLOADS.test(text) || NOT_THE_STORES[store].test(text);
  if (!String(markdown ?? "").trim()) return null;
  const inline = (line) =>
    line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, "$2");
  // Blocks first, a wrapped line joined to its own: headings, items, paragraphs.
  const blocks = [];
  let open = false;
  for (const raw of String(markdown).split("\n")) {
    const line = raw.trim();
    if (!line) {
      open = false;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({ heading: true, text: inline(line.replace(/^#{1,6}\s+/, "")) });
      open = false;
    } else if (/^[-*]\s/.test(line)) {
      blocks.push({ item: true, text: inline(line.replace(/^[-*]\s+/, "")) });
      open = true;
    } else if (open) blocks.at(-1).text += ` ${inline(line)}`;
    else {
      blocks.push({ text: inline(line) });
      open = true;
    }
  }
  const kept = blocks.filter((b) => b.heading || !notTheStore(b.text));
  // A heading with nothing left under it goes too.
  const lines = [];
  const headings = new Set();
  kept.forEach((b, i) => {
    if (b.heading) {
      const next = kept[i + 1];
      if (!next || next.heading) return;
      if (lines.length) lines.push("");
      headings.add(lines.length);
      lines.push(b.text);
      lines.push("");
    } else lines.push(b.item ? `• ${b.text}` : b.text);
  });
  const text = lines.join("\n").trim() || "Fixes and improvements.";
  const limit = NOTES_LIMITS[store];
  if (text.length <= limit) return text;
  if (store === "mac") return `${text.slice(0, limit - 2).replace(/\s+\S*$/, "")} …`;
  // Whole lines while they fit, and a heading never left last.
  let n = 0;
  while (n < lines.length && [...lines.slice(0, n + 1), "…"].join("\n").length <= limit) n++;
  while (n > 0 && (!lines[n - 1] || headings.has(n - 1))) n--;
  if (!n) return `${text.slice(0, limit - 2).replace(/\s+\S*$/, "")} …`;
  return `${lines.slice(0, n).join("\n").trim()}\n…`;
}

// --- the listing --------------------------------------------------------------------------

/** What the listing may hold, with App Store Connect's limits. */
const LIMITS = {
  subtitle: 30,
  promotionalText: 170,
  description: 4000,
  keywords: 100,
};

/**
 * The listing the machine writes with each release (scripts/store/listing.json),
 * held to App Store Connect's limits before anything is sent: one language,
 * the app's information (subtitle, privacy policy) and the version's (its
 * promotional text, description, keywords and addresses).
 */
export function readListing(text) {
  const doc = JSON.parse(text);
  const fail = (m) => {
    throw new Error(`scripts/store/listing.json: ${m}`);
  };
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(doc.locale ?? "")) fail("locale is a language, as en-US");
  const app = doc.app ?? {};
  const version = doc.version ?? {};
  const all = { ...app, ...version };
  for (const [field, max] of Object.entries(LIMITS)) {
    if (typeof all[field] !== "string" || !all[field].trim()) fail(`${field} is missing`);
    if (all[field].length > max) fail(`${field} is ${all[field].length} characters, past ${max}`);
  }
  for (const field of ["privacyPolicyUrl", "supportUrl", "marketingUrl"])
    if (!/^https:\/\/[^\s]+$/.test(all[field] ?? "")) fail(`${field} is not an https address`);
  if (/,\s|\s,/.test(version.keywords)) fail("keywords are separated by commas alone");
  return {
    locale: doc.locale,
    app: { subtitle: app.subtitle, privacyPolicyUrl: app.privacyPolicyUrl },
    version: {
      promotionalText: version.promotionalText,
      description: version.description,
      keywords: version.keywords,
      supportUrl: version.supportUrl,
      marketingUrl: version.marketingUrl,
    },
  };
}

// --- App Review's answer -------------------------------------------------------------------

const APPROVED = new Set([
  "PENDING_APPLE_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
  "READY_FOR_DISTRIBUTION",
  "READY_FOR_SALE",
  "PENDING_DEVELOPER_RELEASE",
]);
const REJECTED = { METADATA_REJECTED: "metadata", REJECTED: "binary", INVALID_BINARY: "binary" };

/**
 * A version's state as the release machine keeps it: waiting on App Review,
 * approved (and so on sale, released by its approval), or rejected, for its
 * listing (`metadata`, which the same build can go again with) or its build
 * (`binary`, mended by the next release). One withdrawn by hand is not
 * App Review's answer, and is said as `withdrawn`.
 */
export function reviewOf(appState) {
  if (APPROVED.has(appState)) return { state: "approved", kind: null };
  if (REJECTED[appState]) return { state: "rejected", kind: REJECTED[appState] };
  if (appState === "DEVELOPER_REJECTED") return { state: "rejected", kind: "withdrawn" };
  return { state: "waiting", kind: null };
}

/**
 * `version`'s state in App Store Connect now: `{ appState, state, kind, page }`.
 * A version App Store Connect no longer has by that number is `gone`: App
 * Review refused it, or it was withdrawn, and a newer release took the
 * version over and renamed it (submitVersion).
 */
export async function reviewState({ api, identifier, version }) {
  const app = await appOf(api, identifier);
  const v = ok(
    await api(
      "GET",
      `/v1/apps/${q(app.id)}/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=${q(version)}`,
    ),
    "the version",
  ).data?.[0];
  if (!v) return { appState: "GONE", state: "gone", kind: null, page: versionPage(app.id) };
  const appState = v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? "UNKNOWN";
  return { appState, ...reviewOf(appState), page: versionPage(app.id) };
}

// --- the submission -------------------------------------------------------------------------

/** The version states from which a build may still be chosen and submitted. */
const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

/**
 * Another version a newer release waits for: in App Review's queue, in
 * review, or approved and on its way to sale. App Store Connect starts a new
 * version only once the current one is on sale (Ready for Distribution), and
 * an earlier version waiting for review is never cancelled for a newer one:
 * it keeps its place in the queue, and the newer goes the moment it is on
 * sale, so a release never loses the review it has waited for. A rejected
 * one takes edits again, and becomes the newer release's.
 */
const AWAITED = new Set([
  "WAITING_FOR_REVIEW",
  "WAITING_FOR_EXPORT_COMPLIANCE",
  "IN_REVIEW",
  "ACCEPTED",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
]);

const stateOf = (v) => v?.attributes?.appVersionState ?? v?.attributes?.appStoreState ?? null;

/**
 * What another version in flight means for submitting `version` (`versions`
 * the app's Mac versions, as App Store Connect lists them): `{ wait }`, one
 * waiting for review, in review or approved, which this one waits for; or
 * null, nothing in the way. Pure.
 */
export function inTheWay(versions, version) {
  const others = (versions ?? []).filter((v) => v.attributes?.versionString !== version);
  const awaited = others.find((v) => AWAITED.has(stateOf(v)));
  if (!awaited) return null;
  return {
    wait: {
      version: awaited.attributes?.versionString ?? null,
      appState: stateOf(awaited),
      id: awaited.id,
    },
  };
}

/**
 * `shots` (each `{ fileName, bytes }`) as the version's Mac screenshots, in
 * order, in place of the ones it had: each reserved, sent in the parts App
 * Store Connect names, and committed with its checksum.
 */
export async function replaceScreenshots({
  api,
  put,
  localization,
  shots,
  wait = sleep,
  // Twenty minutes. Three were not enough on 2026-11-04: four of seven were
  // COMPLETE and three still UPLOAD_COMPLETE when the wait gave up.
  tries = 240,
  every = 5000,
}) {
  const sets = ok(
    await api("GET", `/v1/appStoreVersionLocalizations/${q(localization)}/appScreenshotSets`),
    "the screenshot sets",
  ).data;
  let set = (sets ?? []).find((s) => s.attributes?.screenshotDisplayType === "APP_DESKTOP");
  if (!set)
    set = ok(
      await api("POST", "/v1/appScreenshotSets", {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: "APP_DESKTOP" },
          relationships: {
            appStoreVersionLocalization: {
              data: { type: "appStoreVersionLocalizations", id: localization },
            },
          },
        },
      }),
      "the Mac screenshot set",
    ).data;
  const had = ok(
    await api("GET", `/v1/appScreenshotSets/${q(set.id)}/appScreenshots`),
    "the screenshots",
  ).data;
  for (const s of had ?? [])
    ok(await api("DELETE", `/v1/appScreenshots/${q(s.id)}`), "an earlier screenshot removed");
  const ids = [];
  for (const shot of shots) {
    const made = ok(
      await api("POST", "/v1/appScreenshots", {
        data: {
          type: "appScreenshots",
          attributes: { fileName: shot.fileName, fileSize: shot.bytes.length },
          relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } },
        },
      }),
      `${shot.fileName} reserved`,
    ).data;
    for (const op of made.attributes?.uploadOperations ?? []) {
      const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
      await put(op.url, headers, shot.bytes.subarray(op.offset, op.offset + op.length), op.method);
    }
    ok(
      await api("PATCH", `/v1/appScreenshots/${q(made.id)}`, {
        data: {
          type: "appScreenshots",
          id: made.id,
          attributes: {
            uploaded: true,
            sourceFileChecksum: createHash("md5").update(shot.bytes).digest("hex"),
          },
        },
      }),
      `${shot.fileName} committed`,
    );
    ids.push(made.id);
  }
  ok(
    await api("PATCH", `/v1/appScreenshotSets/${q(set.id)}/relationships/appScreenshots`, {
      data: ids.map((id) => ({ type: "appScreenshots", id })),
    }),
    "the screenshots put in order",
  );
  // App Store Connect processes each upload after it is committed, and a
  // version whose screenshots are still processing "cannot be reviewed" (409,
  // 1.0.4's first submission, 2026-10-23): wait until each is COMPLETE.
  for (let i = 0; ; i++) {
    const states = [];
    for (const id of ids) {
      const s = ok(await api("GET", `/v1/appScreenshots/${q(id)}`), "a screenshot's processing")
        .data?.attributes?.assetDeliveryState;
      states.push(s ?? {});
    }
    const failed = states.find((s) => s.state === "FAILED");
    if (failed)
      throw new Error(
        `App Store Connect could not process a screenshot: ${(failed.errors ?? []).map((e) => e.description ?? e.code).join("; ") || "no reason given"}`,
      );
    if (states.every((s) => s.state === "COMPLETE")) break;
    if (i + 1 >= tries)
      throw new Error(
        `App Store Connect had not processed the screenshots after ${Math.round((tries * every) / 1000)} s: ${states.map((s) => s.state ?? "unknown").join(", ")}`,
      );
    await wait(every);
  }
  return ids.length;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `call`, asked again while App Store Connect answers 409: a review step can
 * meet a version still settling after its last change.
 */
/** Whether App Store Connect's refusal says the item is in the submission already. */
export function alreadyAdded(r) {
  return (r.json?.errors ?? []).some((e) =>
    /already added to this reviewSubmission/i.test(`${e.detail ?? ""} ${e.title ?? ""}`),
  );
}

async function settled(call, { wait = sleep, tries = 4, every = 20000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (e) {
      if (e.status !== 409 || i >= tries) throw e;
      await wait(every);
    }
  }
}

/**
 * Build `build` of `version` submitted for App Review, the version set to go
 * on sale once approved, with everything the release writes: its listing, its
 * What's New (`notes`, on every version after the first, which App Store
 * Connect asks for and refuses on the first) and its screenshots. Every step
 * first looks for what an earlier attempt made: a metadata rejection is
 * answered by this again, with the same build.
 */
export async function submitVersion({
  api,
  put,
  identifier,
  version,
  build,
  notes,
  listing,
  shots,
  wait = sleep,
}) {
  if (!notes)
    throw new Error(`${version} has no notes in its changelog: its What's New is made from them`);
  const steps = [];
  const app = await appOf(api, identifier);

  const b = ok(
    await api(
      "GET",
      `/v1/builds?filter[app]=${q(app.id)}&filter[version]=${q(build)}&filter[preReleaseVersion.version]=${q(version)}&filter[preReleaseVersion.platform]=MAC_OS`,
    ),
    "the build",
  ).data?.[0];
  if (!b) throw new Error(`App Store Connect has no build ${build} of ${version}`);
  if (b.attributes?.processingState !== "VALID")
    throw new Error(
      `build ${build} is ${b.attributes?.processingState ?? "in no state"} in App Store Connect, not VALID`,
    );

  const versions = async (query) =>
    ok(
      await api("GET", `/v1/apps/${q(app.id)}/appStoreVersions?filter[platform]=MAC_OS${query}`),
      "the version",
    ).data ?? [];
  let v = (await versions(`&filter[versionString]=${q(version)}`))[0];
  // Sent already, by an attempt that stopped before its result was kept: it
  // is this release's submission when it carries this release's build, and
  // nothing is sent again (1.0.4, 2026-10-23).
  const sentState = v?.attributes?.appVersionState ?? v?.attributes?.appStoreState;
  if (sentState === "WAITING_FOR_REVIEW" || sentState === "IN_REVIEW") {
    const state = sentState;
    const has = ok(
      await api("GET", `/v1/appStoreVersions/${q(v.id)}/build`),
      "the version's build",
    ).data;
    if (has?.id !== b.id)
      throw new Error(
        `${version} is ${state} in App Store Connect with another build than ${build}`,
      );
    const waiting = ok(
      await api(
        "GET",
        `/v1/reviewSubmissions?filter[app]=${q(app.id)}&filter[platform]=MAC_OS&filter[state]=${q(state)}`,
      ),
      "the review submission",
    ).data;
    steps.push(`${version} already submitted for App Review with build ${build}: ${state}`);
    return {
      app: app.id,
      version: v.id,
      build: b.id,
      submission: waiting?.[0]?.id ?? null,
      state,
      page: versionPage(app.id),
      steps,
    };
  }
  // Another release still in flight, waiting for review, in review, or
  // approved and on its way to sale: waited for, and nothing is changed.
  const all = v ? null : await versions("&limit=200");
  const way = v ? null : inTheWay(all, version);
  if (way?.wait) {
    steps.push(
      `${way.wait.version} is ${way.wait.appState} in App Store Connect: ${version} waits for it`,
    );
    return {
      app: app.id,
      version: null,
      build: b.id,
      submission: null,
      state: "waiting",
      waiting: { version: way.wait.version, appState: way.wait.appState },
      page: versionPage(app.id),
      steps,
    };
  }
  // A store has one version open at a time, and refuses a second (409, "You
  // cannot create a new version of the App in the current state", 1.0.4's
  // first submission, 2026-10-23): the version the record was made with, or
  // one an earlier release left open, becomes this release's, renamed.
  const leftOpen = v ? null : all.find((x) => EDITABLE.has(stateOf(x)));
  if (leftOpen) {
    const was = leftOpen.attributes?.versionString ?? "with no number";
    ok(
      await api("PATCH", `/v1/appStoreVersions/${q(leftOpen.id)}`, {
        data: {
          type: "appStoreVersions",
          id: leftOpen.id,
          attributes: { versionString: version, releaseType: "AFTER_APPROVAL" },
        },
      }),
      `the open version ${was} renamed ${version}`,
    );
    v = {
      ...leftOpen,
      attributes: { ...leftOpen.attributes, versionString: version, releaseType: "AFTER_APPROVAL" },
    };
    steps.push(`the open version ${was} made ${version}, on sale once approved`);
  } else if (!v) {
    v = ok(
      await api("POST", "/v1/appStoreVersions", {
        data: {
          type: "appStoreVersions",
          attributes: { platform: "MAC_OS", versionString: version, releaseType: "AFTER_APPROVAL" },
          relationships: { app: { data: { type: "apps", id: app.id } } },
        },
      }),
      `the version ${version}`,
    ).data;
    steps.push(`version ${version} made, on sale once approved`);
  } else if (v.attributes?.releaseType !== "AFTER_APPROVAL") {
    ok(
      await api("PATCH", `/v1/appStoreVersions/${q(v.id)}`, {
        data: { type: "appStoreVersions", id: v.id, attributes: { releaseType: "AFTER_APPROVAL" } },
      }),
      "the version set to go on sale once approved",
    );
    steps.push("set to go on sale once approved");
  }
  const state = v.attributes?.appVersionState ?? v.attributes?.appStoreState;
  // An attempt that put the version in a review submission and stopped before
  // sending it leaves it READY_FOR_REVIEW, which no longer takes edits: its
  // submission is sent as it is (1.0.4, 2026-10-23).
  const queued = state === "READY_FOR_REVIEW";
  if (state && !EDITABLE.has(state) && !queued)
    throw new Error(`${version} is ${state} in App Store Connect: there is nothing to submit`);
  if (queued) steps.push(`${version} already in a review submission: sent as it is`);
  else {
    ok(
      await api("PATCH", `/v1/appStoreVersions/${q(v.id)}/relationships/build`, {
        data: { type: "builds", id: b.id },
      }),
      `build ${build} chosen for ${version}`,
    );
    steps.push(`build ${build} chosen`);

    // The version's listing in its language, made if it is not there; What's
    // New on every version after the first.
    const onSale = ok(
      await api(
        "GET",
        `/v1/apps/${q(app.id)}/appStoreVersions?filter[platform]=MAC_OS&filter[appVersionState]=READY_FOR_DISTRIBUTION`,
      ),
      "the versions on sale",
    ).data;
    const locs = ok(
      await api("GET", `/v1/appStoreVersions/${q(v.id)}/appStoreVersionLocalizations`),
      "the version's languages",
    ).data;
    let loc = (locs ?? []).find((l) => l.attributes?.locale === listing.locale);
    if (!loc)
      loc = ok(
        await api("POST", "/v1/appStoreVersionLocalizations", {
          data: {
            type: "appStoreVersionLocalizations",
            attributes: { locale: listing.locale },
            relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } },
          },
        }),
        `${version} in ${listing.locale}`,
      ).data;
    ok(
      await api("PATCH", `/v1/appStoreVersionLocalizations/${q(loc.id)}`, {
        data: {
          type: "appStoreVersionLocalizations",
          id: loc.id,
          attributes: { ...listing.version, ...(onSale?.length ? { whatsNew: notes } : {}) },
        },
      }),
      "the version's listing",
    );
    steps.push(`listing written${onSale?.length ? ", What's New with it" : ""}`);

    // The app's own information: its subtitle and privacy policy, on the
    // information App Store Connect lets change, beside a version in progress.
    const infos = ok(
      await api("GET", `/v1/apps/${q(app.id)}/appInfos`),
      "the app's information",
    ).data;
    const live = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"]);
    const info = (infos ?? []).find(
      (i) => !live.has(i.attributes?.state ?? i.attributes?.appStoreState),
    );
    if (info) {
      const infoLocs = ok(
        await api("GET", `/v1/appInfos/${q(info.id)}/appInfoLocalizations`),
        "the app's languages",
      ).data;
      const infoLoc = (infoLocs ?? []).find((l) => l.attributes?.locale === listing.locale);
      if (infoLoc) {
        ok(
          await api("PATCH", `/v1/appInfoLocalizations/${q(infoLoc.id)}`, {
            data: { type: "appInfoLocalizations", id: infoLoc.id, attributes: listing.app },
          }),
          "the app's subtitle and privacy policy",
        );
        steps.push("subtitle and privacy policy written");
      }
    }

    if (shots?.length) {
      const n = await replaceScreenshots({ api, put, localization: loc.id, shots, wait });
      steps.push(`${n} screenshots`);
    }
  }

  const open = ok(
    await api(
      "GET",
      `/v1/reviewSubmissions?filter[app]=${q(app.id)}&filter[platform]=MAC_OS&filter[state]=READY_FOR_REVIEW`,
    ),
    "a review submission",
  ).data;
  let submission = open?.[0];
  if (!submission)
    submission = ok(
      await api("POST", "/v1/reviewSubmissions", {
        data: {
          type: "reviewSubmissions",
          attributes: { platform: "MAC_OS" },
          relationships: { app: { data: { type: "apps", id: app.id } } },
        },
      }),
      "a review submission",
    ).data;
  const items = ok(
    // Which version each item holds is said only when asked for (1.0.4's
    // fifth try put the version in again, and was told it was already there).
    await api("GET", `/v1/reviewSubmissions/${q(submission.id)}/items?include=appStoreVersion`),
    "the submission's items",
  ).data;
  if (!(items ?? []).some((i) => i.relationships?.appStoreVersion?.data?.id === v.id))
    await settled(
      async () => {
        const r = await api("POST", "/v1/reviewSubmissionItems", {
          data: {
            type: "reviewSubmissionItems",
            relationships: {
              reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
              appStoreVersion: { data: { type: "appStoreVersions", id: v.id } },
            },
          },
        });
        // In the submission already: what this call was for.
        if (r.status === 409 && alreadyAdded(r)) return r.json;
        return ok(r, `${version} put in the submission`);
      },
      { wait },
    );
  const sent = (
    await settled(
      async () =>
        ok(
          await api("PATCH", `/v1/reviewSubmissions/${q(submission.id)}`, {
            data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } },
          }),
          "the submission sent",
        ),
      { wait },
    )
  ).data;
  steps.push("submitted for App Review");
  return {
    app: app.id,
    version: v.id,
    build: b.id,
    submission: submission.id,
    state: sent?.attributes?.state ?? "WAITING_FOR_REVIEW",
    page: versionPage(app.id),
    steps,
  };
}

// --- the profile ----------------------------------------------------------------------------

/** How long before it lapses a profile is made again. */
export const PROFILE_MARGIN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether an App Store profile `current` (readProfile's, or null), the Mac's
 * or the iPad's, needs making again: there is none, it names another
 * certificate than the one that signs, or it lapses within the margin.
 */
export function profileDue(current, certificateSha1, now = Date.now()) {
  if (!current) return "there is no profile yet";
  if (!current.certificates.includes(certificateSha1))
    return "the profile names another certificate than the one that signs";
  const left = Date.parse(current.expires) - now;
  if (!Number.isFinite(left) || left < PROFILE_MARGIN_MS)
    return `the profile lapses ${current.expires}`;
  return null;
}

/**
 * A new App Store profile for `identifier`, naming the certificate whose
 * SHA-1 is `certificateSha1`: its bytes. The Mac App Store's by default; the
 * iPad's with `profileType: "IOS_APP_STORE"` and `platforms: ["IOS",
 * "UNIVERSAL"]`, an App ID being the Mac's, the iPad's or both. Apple keeps
 * the earlier one, which lapses by itself. Throws with `status` 403 when the
 * key may not make one.
 */
export async function makeProfile({
  api,
  identifier,
  certificateSha1,
  name,
  profileType = "MAC_APP_STORE",
  platforms = ["MAC_OS", "UNIVERSAL"],
}) {
  const ids = ok(
    await api("GET", `/v1/bundleIds?filter[identifier]=${q(identifier)}&limit=20`),
    "the bundle ID",
  ).data;
  const bundle = (ids ?? []).find(
    (b) => b.attributes?.identifier === identifier && platforms.includes(b.attributes?.platform),
  );
  if (!bundle)
    throw new Error(
      `the developer account has no bundle ID ${identifier} for ${platforms.join(" or ")}`,
    );
  const certs = ok(
    await api(
      "GET",
      "/v1/certificates?filter[certificateType]=DISTRIBUTION,MAC_APP_DISTRIBUTION&limit=200",
    ),
    "the certificates",
  ).data;
  const cert = (certs ?? []).find(
    (c) =>
      c.attributes?.certificateContent &&
      createHash("sha1")
        .update(Buffer.from(c.attributes.certificateContent, "base64"))
        .digest("hex")
        .toUpperCase() === certificateSha1,
  );
  if (!cert)
    throw new Error(
      "the developer account has no Apple Distribution certificate matching the keychain's",
    );
  const made = ok(
    await api("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name, profileType },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: { data: [{ type: "certificates", id: cert.id }] },
        },
      },
    }),
    `the ${profileType === "MAC_APP_STORE" ? "Mac App Store" : "App Store"} profile`,
  ).data;
  const content = made?.attributes?.profileContent;
  if (!content) throw new Error("App Store Connect made the profile and sent none of it");
  return Buffer.from(content, "base64");
}
