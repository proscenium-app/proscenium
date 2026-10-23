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
  const said = (r.json?.errors ?? []).map((e) => e.detail ?? e.title).join("; ");
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
 * A list item, or a paragraph, the store's copy leaves out: the download's
 * updater and its tracks, and Windows. The Mac App Store updates its copy
 * itself, and a listing names no other platform.
 */
const NOT_THE_STORES =
  /\bWindows\b|\bupdater\b|Settings › Updates|\bupdate[sd]? (?:itself|automatically|by itself)\b|\b(?:Alpha|Beta|Stable)\b|\btest version\b|\bproscenium\.ink\/download/i;

/**
 * A release's public notes (its changelog section) as the store's What's
 * New: plain text, a paragraph or an item a line, without what is not the
 * store's, at most 4000 characters. Null when there are no notes at all; a
 * release whose every line was the download's says only that it was mended.
 */
export function storeNotes(markdown) {
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
  const kept = blocks.filter((b) => b.heading || !NOT_THE_STORES.test(b.text));
  // A heading with nothing left under it goes too.
  const lines = [];
  kept.forEach((b, i) => {
    if (b.heading) {
      const next = kept[i + 1];
      if (!next || next.heading) return;
      if (lines.length) lines.push("");
      lines.push(b.text);
      lines.push("");
    } else lines.push(b.item ? `• ${b.text}` : b.text);
  });
  const text = lines.join("\n").trim() || "Fixes and improvements.";
  return text.length <= 4000 ? text : `${text.slice(0, 3998).replace(/\s+\S*$/, "")} …`;
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

/** `version`'s state in App Store Connect now: `{ appState, state, kind, page }`. */
export async function reviewState({ api, identifier, version }) {
  const app = await appOf(api, identifier);
  const v = ok(
    await api(
      "GET",
      `/v1/apps/${q(app.id)}/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=${q(version)}`,
    ),
    "the version",
  ).data?.[0];
  if (!v) throw new Error(`App Store Connect has no version ${version}`);
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
 * `shots` (each `{ fileName, bytes }`) as the version's Mac screenshots, in
 * order, in place of the ones it had: each reserved, sent in the parts App
 * Store Connect names, and committed with its checksum.
 */
export async function replaceScreenshots({ api, put, localization, shots }) {
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
  return ids.length;
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

  let v = ok(
    await api(
      "GET",
      `/v1/apps/${q(app.id)}/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=${q(version)}`,
    ),
    "the version",
  ).data?.[0];
  if (!v) {
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
  if (state && !EDITABLE.has(state))
    throw new Error(`${version} is ${state} in App Store Connect: there is nothing to submit`);

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
    const n = await replaceScreenshots({ api, put, localization: loc.id, shots });
    steps.push(`${n} screenshots`);
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
    await api("GET", `/v1/reviewSubmissions/${q(submission.id)}/items`),
    "the submission's items",
  ).data;
  if (!(items ?? []).some((i) => i.relationships?.appStoreVersion?.data?.id === v.id))
    ok(
      await api("POST", "/v1/reviewSubmissionItems", {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
            appStoreVersion: { data: { type: "appStoreVersions", id: v.id } },
          },
        },
      }),
      `${version} put in the submission`,
    );
  const sent = ok(
    await api("PATCH", `/v1/reviewSubmissions/${q(submission.id)}`, {
      data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } },
    }),
    "the submission sent",
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
 * Whether the Mac App Store profile `current` (readProfile's, or null) needs
 * making again: there is none, it names another certificate than the one
 * that signs, or it lapses within the margin.
 */
export function profileDue(current, certificateSha1, now = Date.now()) {
  if (!current) return "there is no Mac App Store profile";
  if (!current.certificates.includes(certificateSha1))
    return "the profile names another certificate than the one that signs";
  const left = Date.parse(current.expires) - now;
  if (!Number.isFinite(left) || left < PROFILE_MARGIN_MS)
    return `the profile lapses ${current.expires}`;
  return null;
}

/**
 * A new Mac App Store profile for `identifier`, naming the certificate whose
 * SHA-1 is `certificateSha1`: its bytes. Apple keeps the earlier one, which
 * lapses by itself. Throws with `status` 403 when the key may not make one.
 */
export async function makeProfile({ api, identifier, certificateSha1, name }) {
  const ids = ok(
    await api("GET", `/v1/bundleIds?filter[identifier]=${q(identifier)}&limit=20`),
    "the bundle ID",
  ).data;
  const bundle = (ids ?? []).find(
    (b) =>
      b.attributes?.identifier === identifier &&
      ["MAC_OS", "UNIVERSAL"].includes(b.attributes?.platform),
  );
  if (!bundle) throw new Error(`the developer account has no Mac bundle ID ${identifier}`);
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
        attributes: { name, profileType: "MAC_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: { data: [{ type: "certificates", id: cert.id }] },
        },
      },
    }),
    "the Mac App Store profile",
  ).data;
  const content = made?.attributes?.profileContent;
  if (!content) throw new Error("App Store Connect made the profile and sent none of it");
  return Buffer.from(content, "base64");
}
