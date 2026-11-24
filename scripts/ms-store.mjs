// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Microsoft Store submission API, as the Microsoft Store channel uses it
 * (docs/engineering/services-and-feedback.md#SERV-85: the Store's copy has no
 * updater, and the Store keeps it current): each stable release's two
 * packages, one for each chip, submitted in place of the last release's, with
 * its What's new; and certification's answer read afterwards.
 *
 * Every flow takes `api(method, path, body)`, which answers `{ status, json }`,
 * `put(url, bytes)` for the packages' archive, and `zip(files)` to make it.
 * Nothing here reaches the network on its own: `apiOf()` and `putOf()` are
 * the real ones, with a key from Partner Center (a Microsoft Entra
 * application's tenant, client and secret), so every flow is tested against
 * a played Partner Center. Each first looks for what an earlier attempt made,
 * so each can run again.
 *
 * What the API does not reach, and stays a person's: the product itself, its
 * first submission with the age rating, the Entra tenant and the application
 * linked to Partner Center, the product's properties (privacy policy, support
 * contact, website), and the reasons in a certification report beyond the
 * codes the API returns.
 */

export const API = "https://manage.devcenter.microsoft.com";
const LOGIN = "https://login.microsoftonline.com";

/** Where a submission's page is in Partner Center, for a person to read. */
export const submissionPage = (storeId, submission) =>
  submission
    ? `https://partner.microsoft.com/dashboard/products/${storeId}/submissions/${submission}`
    : `https://partner.microsoft.com/dashboard/products/${storeId}/overview`;

/**
 * An access token for the submission API: Microsoft Entra's client
 * credentials, for the resource the API names. Good for an hour.
 */
export async function msToken({ tenantId, clientId, secret }, { fetcher = fetch } = {}) {
  const r = await fetcher(`${LOGIN}/${encodeURIComponent(tenantId)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: secret,
      resource: API,
    }).toString(),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!r.ok || !json?.access_token) {
    // Entra names the fault by a code (AADSTS7000222: the secret has expired);
    // its description can carry the request's ids, and never the secret.
    const code = /AADSTS\d+/.exec(json?.error_description ?? "")?.[0];
    throw new Error(
      `Microsoft Entra refused the Store key (${r.status}${json?.error ? `, ${json.error}` : ""}${code ? `, ${code}` : ""})`,
    );
  }
  return json.access_token;
}

/** The API, with `key` (`{ tenantId, clientId, secret }`): one token, made again before it lapses. */
export function apiOf(key, { fetcher = fetch, now = Date.now } = {}) {
  let token = null;
  let until = 0;
  return async (method, path, body) => {
    if (!token || now() > until) {
      token = await msToken(key, { fetcher });
      until = now() + 50 * 60_000;
    }
    const r = await fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
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

/**
 * The packages' archive, to the address Partner Center made for the
 * submission (an Azure blob, written whole). A plus sign in its signature is
 * sent as `%2B`, as Microsoft's own tool sends it.
 */
export function putOf({ fetcher = fetch } = {}) {
  return async (url, bytes) => {
    const r = await fetcher(String(url).replace(/\+/g, "%2B"), {
      method: "PUT",
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/zip" },
      body: bytes,
      signal: AbortSignal.timeout(600_000),
    });
    if (!r.ok) throw new Error(`the packages' archive was refused: ${r.status}`);
  };
}

const q = encodeURIComponent;

/** The answer's JSON, or why Partner Center refused, with `what` was asked. */
function ok(r, what) {
  if (r.status >= 200 && r.status < 300) return r.json;
  const said = [r.json?.code, r.json?.message, ...(r.json?.errors ?? []).map(detailOf)]
    .filter(Boolean)
    .join("; ");
  const e = new Error(`${what}: Partner Center answered ${r.status}${said ? `: ${said}` : ""}`);
  e.status = r.status;
  throw e;
}

const detailOf = (e) => [e?.code, e?.details ?? e?.message].filter(Boolean).join(": ");

// --- what's new -------------------------------------------------------------------------------

/** Partner Center's limit on a version's release notes (What's new in this version). */
export const NOTES_LIMIT = 1500;

// --- certification's answer -----------------------------------------------------------------------

/** A submission still on its way: committed and not yet published, failed or cancelled. */
const IN_FLIGHT = new Set([
  "CommitStarted",
  "PreProcessing",
  "Certification",
  "Release",
  "PendingPublication",
  "Publishing",
]);
const FAILED = new Set([
  "CommitFailed",
  "PreProcessingFailed",
  "CertificationFailed",
  "ReleaseFailed",
  "PublishFailed",
]);

/** Whether a submission in `status` is still on its way through the Store. */
export const inFlight = (status) => IN_FLIGHT.has(status);

/**
 * A submission's state as the release machine keeps it: on its way through
 * certification and publication (`waiting`), `published` (in the Store),
 * `failed` (at its commit, its checks, certification or publication; `kind`
 * says which), or `canceled` in Partner Center by hand.
 */
export function certificationOf(status) {
  if (status === "Published") return { state: "published", kind: null };
  if (FAILED.has(status)) return { state: "failed", kind: status };
  if (status === "Canceled") return { state: "canceled", kind: null };
  return { state: "waiting", kind: null };
}

/** A submission's state now: `{ status, state, kind, errors, page }`. */
export async function certificationState({ api, storeId, submission }) {
  const s = ok(
    await api("GET", `/v1.0/my/applications/${q(storeId)}/submissions/${q(submission)}/status`),
    "the submission's status",
  );
  const status = String(s?.status ?? "None");
  const details = s?.statusDetails ?? {};
  const errors = [...(details.errors ?? []), ...(details.certificationReports ?? [])]
    .map((e) => detailOf(e) || e?.reportUrl)
    .filter(Boolean)
    .join("; ")
    .slice(0, 600);
  return {
    status,
    ...certificationOf(status),
    errors: errors || null,
    page: submissionPage(storeId, submission),
  };
}

// --- the submission ------------------------------------------------------------------------------

/** A release's version as a package says it: `X.Y.Z.0`. */
export const packageVersion = (version) => `${version}.0`;

/** Whether `submission` already carries a package of `version`. */
export function carries(submission, version) {
  return (submission?.applicationPackages ?? []).some(
    (p) => p.version === packageVersion(version) && p.fileStatus !== "PendingDelete",
  );
}

/**
 * The price Partner Center is sent back. An update replaces the whole
 * submission, so a price left out or empty turns the product free, and the
 * newer per-market pricing comes back as `Base`, which an update refuses.
 * Proscenium is free: a price that cannot go back as it came goes as Free,
 * and any other price goes back as it came.
 */
export function pricingOf(pricing) {
  const id = String(pricing?.priceId ?? "").trim();
  if (id && !/^base$/i.test(id)) return pricing;
  return { ...(pricing ?? {}), priceId: "Free" };
}

/** The device families Partner Center asks about, every one of which a submission must answer. */
export const FAMILIES = ["Desktop", "Mobile", "Xbox", "Holographic"];

/**
 * Whether each device family to come may get the app, as the last release
 * left it, and no for any family it left unsaid. Partner Center refuses a
 * submission that leaves one out (400, InvalidParameterValue:
 * "AllowTargetFutureDeviceFamilies needs to be initialized for all supported
 * platform"), and a clone of a submission made by hand can.
 */
export function futureFamiliesOf(given) {
  return Object.fromEntries(FAMILIES.map((f) => [f, given?.[f] === true]));
}

/**
 * The clone Partner Center made of the last published submission, as this
 * release sends it: every package it had marked for removal and `files` (the
 * archive's names) added; the release's notes as each language's What's
 * new; published as soon as it passes certification; and its price as
 * pricingOf says. Everything else stays as the last release left it. Pure.
 */
export function updatedSubmission(clone, { files, notes }) {
  if (!files?.length) throw new Error("a submission needs its packages");
  if (!notes) throw new Error("a submission needs its What's new");
  if (notes.length > NOTES_LIMIT)
    throw new Error(`What's new is ${notes.length} characters, past ${NOTES_LIMIT}`);
  const kept = (clone.applicationPackages ?? [])
    // One added by an attempt that stopped is added again below.
    .filter((p) => p.fileStatus !== "PendingUpload")
    .map((p) => ({ ...p, fileStatus: "PendingDelete" }));
  const listings = Object.fromEntries(
    Object.entries(clone.listings ?? {}).map(([locale, l]) => [
      locale,
      { ...l, baseListing: { ...(l?.baseListing ?? {}), releaseNotes: notes } },
    ]),
  );
  if (!Object.keys(listings).length) throw new Error("the submission has no listing to write");
  const { status: _status, statusDetails: _details, fileUploadUrl: _upload, ...rest } = clone;
  return {
    ...rest,
    pricing: pricingOf(clone.pricing),
    allowTargetFutureDeviceFamilies: futureFamiliesOf(clone.allowTargetFutureDeviceFamilies),
    targetPublishMode: "Immediate",
    listings,
    applicationPackages: [
      ...kept,
      ...files.map((fileName) => ({
        fileName,
        fileStatus: "PendingUpload",
        minimumDirectXVersion: "None",
        minimumSystemRam: "None",
      })),
    ],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Release `version`'s packages (each `{ name, bytes }`) submitted to product
 * `storeId`, with `notes` as What's new, as Partner Center asks: a new
 * submission (a copy of the last published one), its data written, the
 * packages' archive uploaded, and the submission committed; then its status
 * read until the commit has been taken or refused.
 *
 * What is there already decides first, so an attempt that stopped can run
 * again:
 *   - a submission that already carries this version (on its way, or
 *     published) is this release's, and nothing is sent again;
 *   - another release's submission still on its way through certification is
 *     waited for (the API cannot cancel one): `{ waiting }`, nothing changed;
 *   - one this API made that goes nowhere now (a draft, or one refused or
 *     cancelled) is removed and made again;
 *   - one made in Partner Center by hand is a person's work, and is neither
 *     changed nor removed: `{ waiting }` names it.
 */
export async function submitPackages({
  api,
  put,
  zip,
  storeId,
  version,
  packages,
  notes,
  wait = sleep,
  tries = 60,
  every = 10_000,
}) {
  if (!packages?.length) throw new Error(`${version} has no packages to submit`);
  const steps = [];
  const base = `/v1.0/my/applications/${q(storeId)}`;
  const app = ok(await api("GET", base), "the product");
  const get = async (id) => ok(await api("GET", `${base}/submissions/${q(id)}`), "a submission");
  const pending = app?.pendingApplicationSubmission?.id ?? null;
  const published = app?.lastPublishedApplicationSubmission?.id ?? null;
  if (!published)
    throw new Error(
      `${storeId} has no published submission: the first is made by hand in Partner Center`,
    );

  const answer = (fields) => ({
    storeId,
    version: packageVersion(version),
    page: submissionPage(storeId, fields.submission ?? null),
    steps,
    ...fields,
  });

  const last = await get(published);
  if (carries(last, version)) {
    steps.push(`${packageVersion(version)} is published already (submission ${published})`);
    return answer({ submission: published, status: "Published", already: true });
  }
  if (pending) {
    const open = await get(pending);
    const status = String(open?.status ?? "None");
    // On its way, or published: anything else (a draft, one refused at its
    // commit or at certification, one cancelled) is no longer going anywhere.
    const alive = inFlight(status) || status === "Published";
    if (carries(open, version) && alive) {
      steps.push(
        `${packageVersion(version)} is submitted already (submission ${pending}): ${status}`,
      );
      return answer({ submission: pending, status, already: true });
    }
    if (alive) {
      const of = (open?.applicationPackages ?? []).find((p) => p.fileStatus !== "PendingDelete");
      steps.push(`submission ${pending} is on its way (${status}): this release waits for it`);
      return answer({
        submission: null,
        status: null,
        waiting: {
          on: "submission",
          submission: pending,
          status,
          version: of?.version ?? null,
          page: submissionPage(storeId, pending),
        },
      });
    }
    if (!open?.fileUploadUrl) {
      steps.push(`submission ${pending} was made in Partner Center by hand: left as it is`);
      return answer({
        submission: null,
        status: null,
        waiting: {
          on: "draft",
          submission: pending,
          status,
          version: null,
          page: submissionPage(storeId, pending),
        },
      });
    }
    ok(await api("DELETE", `${base}/submissions/${q(pending)}`), "an earlier draft removed");
    steps.push(`an earlier attempt's draft ${pending} removed`);
  }

  const made = ok(await api("POST", `${base}/submissions`), "a new submission");
  if (!made?.id || !made?.fileUploadUrl)
    throw new Error("Partner Center made a submission with no id or no address for its packages");
  steps.push(`submission ${made.id} made from ${published}`);
  const body = updatedSubmission(made, { files: packages.map((p) => p.name), notes });
  ok(await api("PUT", `${base}/submissions/${q(made.id)}`, body), "the submission's data");
  steps.push(`${packages.length} packages and What's new written`);
  await put(made.fileUploadUrl, await zip(packages));
  steps.push("the packages' archive uploaded");
  ok(await api("POST", `${base}/submissions/${q(made.id)}/commit`), "the submission committed");
  steps.push("committed");

  // The commit is taken (PreProcessing) or refused (CommitFailed) in a few minutes.
  for (let i = 0; ; i++) {
    const s = await certificationState({ api, storeId, submission: made.id });
    if (s.status !== "CommitStarted" && s.status !== "PendingCommit") {
      if (s.state === "failed")
        throw new Error(
          `Partner Center refused submission ${made.id} (${s.status})${s.errors ? `: ${s.errors}` : ""}`,
        );
      steps.push(`submitted for certification: ${s.status}`);
      return answer({ submission: made.id, status: s.status });
    }
    if (i + 1 >= tries) {
      steps.push(`still ${s.status} after ${Math.round((tries * every) / 60_000)} min`);
      return answer({ submission: made.id, status: s.status });
    }
    await wait(every);
  }
}
