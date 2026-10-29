// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROFILE_MARGIN_MS,
  ascToken,
  makeProfile,
  profileDue,
  readListing,
  replaceScreenshots,
  reviewOf,
  storeNotes,
  submitVersion,
} from "./app-store-connect.mjs";

const LISTING = readListing(readFileSync(join(import.meta.dir, "store", "listing.json"), "utf8"));

test("the API's token is ES256, for App Store Connect's audience, for twenty minutes", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const p8 = privateKey.export({ type: "pkcs8", format: "pem" });
  const token = ascToken({ keyId: "KEY1234567", issuer: "iss-1", p8, now: 1_000_000_000_000 });
  const [h, b, sig] = token.split(".");
  expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
    alg: "ES256",
    kid: "KEY1234567",
    typ: "JWT",
  });
  expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({
    iss: "iss-1",
    iat: 1_000_000_000,
    exp: 1_000_001_200,
    aud: "appstoreconnect-v1",
  });
  expect(
    verify(
      "sha256",
      Buffer.from(`${h}.${b}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url"),
    ),
  ).toBe(true);
});

describe("What's New, from the release's notes (docs/engineering/release-engineering.md#REL-56)", () => {
  test("plain text, an item a line, without the updater, its tracks or Windows", () => {
    const md = [
      "### Added",
      "",
      "- Proscenium for Windows. The same app, on Windows 11 and Windows 10, on x64",
      "  and Arm PCs. Download it from proscenium.ink.",
      "- Reply to a **comment**. Every comment has a [Reply](https://x.test) button,",
      "  on its card beside the page.",
      "",
      "### Fixed",
      "",
      "- On the Beta track, What's new in Settings › Updates opens the notes.",
      "- A copy installed from a test version follows Beta.",
      "",
      "### Changed",
      "",
      "- The space between pages is the desk's own colour.",
    ].join("\n");
    expect(storeNotes(md)).toBe(
      "Added\n\n• Reply to a comment. Every comment has a Reply button, on its card beside the page.\n\nChanged\n\n• The space between pages is the desk's own colour.",
    );
  });

  test("every line the download's: a line of its own; no notes at all: none", () => {
    expect(storeNotes("### Fixed\n\n- The updater asks once a day.\n")).toBe(
      "Fixes and improvements.",
    );
    expect(storeNotes("")).toBeNull();
    expect(storeNotes("  \n")).toBeNull();
  });

  test("at most 4000 characters, cut at a word", () => {
    const long = storeNotes(`- ${"word ".repeat(2000)}`);
    expect(long.length).toBeLessThanOrEqual(4000);
    expect(long.endsWith(" …")).toBe(true);
  });
});

describe("the listing (scripts/store/listing.json)", () => {
  test("the file holds to App Store Connect's limits", () => {
    expect(LISTING.locale).toBe("en-US");
    expect(LISTING.app.subtitle.length).toBeLessThanOrEqual(30);
    expect(LISTING.version.keywords.length).toBeLessThanOrEqual(100);
  });

  test("a field past its limit, missing, or an address not https is refused by name", () => {
    const base = JSON.parse(readFileSync(join(import.meta.dir, "store", "listing.json"), "utf8"));
    const bad = (change: (d: typeof base) => void) => {
      const d = structuredClone(base);
      change(d);
      return () => readListing(JSON.stringify(d));
    };
    expect(bad((d) => (d.app.subtitle = "x".repeat(31)))).toThrow("subtitle is 31 characters");
    expect(bad((d) => delete d.version.description)).toThrow("description is missing");
    expect(bad((d) => (d.version.supportUrl = "http://x.test"))).toThrow("supportUrl");
    expect(bad((d) => (d.version.keywords = "play, script"))).toThrow("commas alone");
  });
});

test("App Review's answer, as the machine keeps it", () => {
  expect(reviewOf("WAITING_FOR_REVIEW")).toEqual({ state: "waiting", kind: null });
  expect(reviewOf("IN_REVIEW")).toEqual({ state: "waiting", kind: null });
  expect(reviewOf("READY_FOR_DISTRIBUTION")).toEqual({ state: "approved", kind: null });
  expect(reviewOf("PENDING_APPLE_RELEASE")).toEqual({ state: "approved", kind: null });
  expect(reviewOf("METADATA_REJECTED")).toEqual({ state: "rejected", kind: "metadata" });
  expect(reviewOf("REJECTED")).toEqual({ state: "rejected", kind: "binary" });
  expect(reviewOf("INVALID_BINARY")).toEqual({ state: "rejected", kind: "binary" });
  expect(reviewOf("DEVELOPER_REJECTED")).toEqual({ state: "rejected", kind: "withdrawn" });
});

type Call = [string, string, unknown];

/**
 * App Store Connect, played: an app, its processed build, its information,
 * and whatever versions, languages, screenshots and submissions `state`
 * holds. Every call, and every part sent, is kept.
 */
function asc(
  state: {
    versions?: { id: string; attributes: Record<string, unknown> }[];
    onSale?: boolean;
    locs?: { id: string; attributes: Record<string, unknown> }[];
    sets?: { id: string; attributes: Record<string, unknown> }[];
    shots?: { id: string }[];
    submissions?: { id: string }[];
    items?: unknown[];
    processing?: string;
    delivery?: { state: string; errors?: { code: string; description: string }[] }[];
    busy?: boolean[];
    alreadyThere?: boolean;
    versionBuild?: { id: string } | null;
  } = {},
) {
  const calls: Call[] = [];
  const parts: [string, Record<string, string>, number, string][] = [];
  let made = 0;
  const json = (data: unknown, status = 200) => ({ status, json: { data } });
  const api = async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body]);
    if (path.startsWith("/v1/apps?")) return json([{ id: "app1" }]);
    if (path.startsWith("/v1/builds?"))
      return json([{ id: "b1", attributes: { processingState: state.processing ?? "VALID" } }]);
    if (path.includes("appStoreVersions?") && path.includes("READY_FOR_DISTRIBUTION"))
      return json(state.onSale ? [{ id: "old" }] : []);
    if (path.includes("/appStoreVersions?")) {
      // As App Store Connect filters by number: a version that names none matches any.
      const named = /filter\[versionString\]=([^&]+)/.exec(path)?.[1];
      return json(
        (state.versions ?? []).filter(
          (v) =>
            !named ||
            !(v.attributes as { versionString?: string })?.versionString ||
            (v.attributes as { versionString?: string }).versionString ===
              decodeURIComponent(named),
        ),
      );
    }
    if (method === "POST" && path === "/v1/appStoreVersions")
      return json({ id: "v1", attributes: { appVersionState: "PREPARE_FOR_SUBMISSION" } }, 201);
    if (method === "PATCH" && path.startsWith("/v1/appStoreVersions/")) return json({ id: "v1" });
    if (method === "GET" && /^\/v1\/appStoreVersions\/[^/]+\/build$/.test(path))
      return json(state.versionBuild === undefined ? { id: "b1" } : state.versionBuild);
    if (method === "GET" && path.endsWith("/appStoreVersionLocalizations"))
      return json(state.locs ?? []);
    if (method === "POST" && path === "/v1/appStoreVersionLocalizations")
      return json({ id: "loc1", attributes: { locale: "en-US" } }, 201);
    if (path.startsWith("/v1/appStoreVersionLocalizations/") && path.endsWith("/appScreenshotSets"))
      return json(state.sets ?? []);
    if (path.startsWith("/v1/appStoreVersionLocalizations/")) return json({ id: "loc1" });
    if (path.endsWith("/appInfos"))
      return json([
        { id: "live", attributes: { state: "READY_FOR_DISTRIBUTION" } },
        { id: "info1", attributes: { state: "PREPARE_FOR_SUBMISSION" } },
      ]);
    if (path.endsWith("/appInfoLocalizations"))
      return json([{ id: "il1", attributes: { locale: "en-US" } }]);
    if (path.startsWith("/v1/appInfoLocalizations/")) return json({ id: "il1" });
    if (method === "POST" && path === "/v1/appScreenshotSets")
      return json({ id: "set1", attributes: { screenshotDisplayType: "APP_DESKTOP" } }, 201);
    if (path.endsWith("/appScreenshots") && method === "GET") return json(state.shots ?? []);
    if (method === "DELETE" && path.startsWith("/v1/appScreenshots/"))
      return { status: 204, json: null };
    if (method === "POST" && path === "/v1/appScreenshots") {
      made += 1;
      return json(
        {
          id: `shot${made}`,
          attributes: {
            uploadOperations: [
              {
                method: "PUT",
                url: `https://upload.test/${made}/a`,
                offset: 0,
                length: 3,
                requestHeaders: [{ name: "Content-Type", value: "image/png" }],
              },
              {
                method: "PUT",
                url: `https://upload.test/${made}/b`,
                offset: 3,
                length: 2,
                requestHeaders: [],
              },
            ],
          },
        },
        201,
      );
    }
    if (method === "PATCH" && path.startsWith("/v1/appScreenshots/")) return json({});
    // Each upload as App Store Connect processes it: COMPLETE unless the scene says otherwise.
    if (method === "GET" && path.startsWith("/v1/appScreenshots/"))
      return json({
        id: path.split("/").pop(),
        attributes: { assetDeliveryState: state.delivery?.shift() ?? { state: "COMPLETE" } },
      });
    if (method === "POST" && path === "/v1/reviewSubmissionItems" && state.alreadyThere)
      return {
        status: 409,
        json: {
          errors: [
            {
              status: "409",
              detail: "appStoreVersion with id v1 was already added to this reviewSubmission.",
            },
          ],
        },
      };
    if (method === "POST" && path === "/v1/reviewSubmissionItems" && state.busy?.shift())
      return {
        status: 409,
        json: {
          errors: [
            {
              status: "409",
              detail:
                "This resource cannot be reviewed, please check associated errors to see why.",
              meta: {
                associatedErrors: {
                  "/v1/appScreenshots/shot1": [
                    { detail: "The screenshot is still being processed." },
                  ],
                },
              },
            },
          ],
        },
      };
    if (path.endsWith("/relationships/appScreenshots")) return { status: 204, json: null };
    if (path.endsWith("/relationships/build")) return { status: 204, json: null };
    if (path.startsWith("/v1/reviewSubmissions?")) return json(state.submissions ?? []);
    if (method === "POST" && path === "/v1/reviewSubmissions") return json({ id: "s1" }, 201);
    if (path.includes("/items")) return json(state.items ?? []);
    if (method === "POST" && path === "/v1/reviewSubmissionItems") return json({ id: "i1" }, 201);
    if (method === "PATCH" && path.startsWith("/v1/reviewSubmissions/"))
      return json({ id: "s1", attributes: { state: "WAITING_FOR_REVIEW" } });
    return { status: 404, json: { errors: [{ title: `not played: ${method} ${path}` }] } };
  };
  const put = async (url: string, headers: Record<string, string>, bytes: Buffer) => {
    parts.push([url, headers, bytes.length, bytes.toString()]);
  };
  return { api, put, calls, parts };
}

const SHOTS = [
  { fileName: "01-script.png", bytes: Buffer.from("aaabb") },
  { fileName: "02-board.png", bytes: Buffer.from("cccdd") },
];
const SUBMIT = {
  identifier: "org.habiby.proscenium",
  version: "1.0.3",
  build: "1.0.3001",
  notes: "Fixed\n\n• A fix.",
  listing: LISTING,
  shots: SHOTS,
};
const body = (calls: Call[], method: string, path: string) =>
  calls.find(([m, p]) => m === method && p === path)?.[2] as
    | { data: { attributes: Record<string, unknown> } }
    | undefined;

describe("written and submitted for App Review (docs/engineering/release-engineering.md#REL-56)", () => {
  test("the first version: made to go on sale once approved, its listing, no What's New, its screenshots, submitted", async () => {
    const s = asc();
    const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put });
    expect(done).toMatchObject({
      app: "app1",
      version: "v1",
      submission: "s1",
      state: "WAITING_FOR_REVIEW",
    });
    expect(done.page).toBe(
      "https://appstoreconnect.apple.com/apps/app1/distribution/macos/version/inflight",
    );
    expect(done.steps).toEqual([
      "version 1.0.3 made, on sale once approved",
      "build 1.0.3001 chosen",
      "listing written",
      "subtitle and privacy policy written",
      "2 screenshots",
      "submitted for App Review",
    ]);
    expect(body(s.calls, "POST", "/v1/appStoreVersions")?.data.attributes).toEqual({
      platform: "MAC_OS",
      versionString: "1.0.3",
      releaseType: "AFTER_APPROVAL",
    });
    const listing = body(s.calls, "PATCH", "/v1/appStoreVersionLocalizations/loc1");
    expect(listing?.data.attributes).toEqual(LISTING.version);
    expect(body(s.calls, "PATCH", "/v1/appInfoLocalizations/il1")?.data.attributes).toEqual(
      LISTING.app,
    );
    // The app's information on sale is never the one written.
    expect(s.calls.some(([, p]) => p === "/v1/appInfos/live/appInfoLocalizations")).toBe(false);
    expect(s.calls.at(-1)?.[1]).toBe("/v1/reviewSubmissions/s1");
  });

  test("a later version: its What's New written with the listing; one made by hand set to go on sale once approved", async () => {
    const s = asc({
      onSale: true,
      versions: [
        {
          id: "v1",
          attributes: { appVersionState: "PREPARE_FOR_SUBMISSION", releaseType: "MANUAL" },
        },
      ],
      locs: [{ id: "loc1", attributes: { locale: "en-US" } }],
    });
    const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put });
    expect(done.steps.slice(0, 3)).toEqual([
      "set to go on sale once approved",
      "build 1.0.3001 chosen",
      "listing written, What's New with it",
    ]);
    expect(body(s.calls, "PATCH", "/v1/appStoreVersions/v1")?.data.attributes).toEqual({
      releaseType: "AFTER_APPROVAL",
    });
    expect(
      body(s.calls, "PATCH", "/v1/appStoreVersionLocalizations/loc1")?.data.attributes.whatsNew,
    ).toBe("Fixed\n\n• A fix.");
    // The language was there: none is made.
    expect(s.calls.some(([m, p]) => m === "POST" && p === "/v1/appStoreVersionLocalizations")).toBe(
      false,
    );
  });

  test("sent again after a refused listing: the same version and build, its submission taken as it is", async () => {
    const s = asc({
      onSale: true,
      versions: [
        {
          id: "v1",
          attributes: { appVersionState: "METADATA_REJECTED", releaseType: "AFTER_APPROVAL" },
        },
      ],
      locs: [{ id: "loc1", attributes: { locale: "en-US" } }],
      submissions: [{ id: "s1" }],
      items: [{ relationships: { appStoreVersion: { data: { id: "v1" } } } }],
    });
    const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put, shots: [] });
    expect(done.steps).toEqual([
      "build 1.0.3001 chosen",
      "listing written, What's New with it",
      "subtitle and privacy policy written",
      "submitted for App Review",
    ]);
    expect(
      s.calls.filter(([m, p]) => m === "POST" && /appStoreVersions$|reviewSubmission/.test(p)),
    ).toEqual([]);
  });

  test("refused: no notes, a build not processed, a version App Review has", async () => {
    await expect(submitVersion({ ...SUBMIT, notes: null, ...asc() })).rejects.toThrow(
      "1.0.3 has no notes in its changelog",
    );
    await expect(
      submitVersion({ ...SUBMIT, ...asc({ processing: "PROCESSING" }) }),
    ).rejects.toThrow("build 1.0.3001 is PROCESSING in App Store Connect, not VALID");
    // App Review has it with another build than this release's.
    await expect(
      submitVersion({
        ...SUBMIT,
        ...asc({
          versions: [{ id: "v1", attributes: { appVersionState: "IN_REVIEW" } }],
          versionBuild: { id: "b0" },
        }),
      }),
    ).rejects.toThrow("1.0.3 is IN_REVIEW in App Store Connect with another build than 1.0.3001");
  });
});

test("the screenshots: the old ones removed, each new one sent in the parts named and committed with its checksum, in order", async () => {
  const s = asc({
    sets: [{ id: "set9", attributes: { screenshotDisplayType: "APP_DESKTOP" } }],
    shots: [{ id: "old1" }, { id: "old2" }],
  });
  expect(
    await replaceScreenshots({ api: s.api, put: s.put, localization: "loc1", shots: SHOTS }),
  ).toBe(2);
  expect(s.calls.filter(([m]) => m === "DELETE").map(([, p]) => p)).toEqual([
    "/v1/appScreenshots/old1",
    "/v1/appScreenshots/old2",
  ]);
  expect(s.parts).toEqual([
    ["https://upload.test/1/a", { "Content-Type": "image/png" }, 3, "aaa"],
    ["https://upload.test/1/b", {}, 2, "bb"],
    ["https://upload.test/2/a", { "Content-Type": "image/png" }, 3, "ccc"],
    ["https://upload.test/2/b", {}, 2, "dd"],
  ]);
  expect(body(s.calls, "PATCH", "/v1/appScreenshots/shot1")?.data.attributes).toEqual({
    uploaded: true,
    sourceFileChecksum: createHash("md5").update("aaabb").digest("hex"),
  });
  const order = s.calls.find(
    ([, p]) => p === "/v1/appScreenshotSets/set9/relationships/appScreenshots",
  )?.[2] as { data: { id: string }[] } | undefined;
  expect(order?.data.map((d) => d.id)).toEqual(["shot1", "shot2"]);
  // A localization with no Mac set gets one.
  const fresh = asc();
  await replaceScreenshots({ api: fresh.api, put: fresh.put, localization: "loc1", shots: SHOTS });
  expect(body(fresh.calls, "POST", "/v1/appScreenshotSets")?.data.attributes).toEqual({
    screenshotDisplayType: "APP_DESKTOP",
  });
});

describe("the Mac App Store profile, made by the API (docs/engineering/release-engineering.md#REL-56)", () => {
  const SHA = "A".repeat(40);
  const NOW = Date.parse("2026-10-19T00:00:00Z");
  test("made when there is none, it names another certificate, or it lapses within a month", () => {
    expect(profileDue(null, SHA, NOW)).toBe("there is no Mac App Store profile");
    expect(profileDue({ certificates: ["B".repeat(40)], expires: "2027-10-01" }, SHA, NOW)).toBe(
      "the profile names another certificate than the one that signs",
    );
    const soon = new Date(NOW + PROFILE_MARGIN_MS - 1000).toISOString();
    expect(profileDue({ certificates: [SHA], expires: soon }, SHA, NOW)).toBe(
      `the profile lapses ${soon}`,
    );
    expect(profileDue({ certificates: [SHA], expires: "2027-10-01" }, SHA, NOW)).toBeNull();
  });

  test("for the Mac bundle ID and the certificate the keychain signs with, found by its fingerprint", async () => {
    const der = Buffer.from("a certificate");
    const sha = createHash("sha1").update(der).digest("hex").toUpperCase();
    const calls: Call[] = [];
    const api = async (method: string, path: string, b?: unknown) => {
      calls.push([method, path, b]);
      if (path.startsWith("/v1/bundleIds"))
        return {
          status: 200,
          json: {
            data: [
              { id: "ios", attributes: { identifier: "org.habiby.proscenium", platform: "IOS" } },
              {
                id: "mac",
                attributes: { identifier: "org.habiby.proscenium", platform: "MAC_OS" },
              },
            ],
          },
        };
      if (path.startsWith("/v1/certificates"))
        return {
          status: 200,
          json: {
            data: [
              {
                id: "other",
                attributes: { certificateContent: Buffer.from("x").toString("base64") },
              },
              { id: "c1", attributes: { certificateContent: der.toString("base64") } },
            ],
          },
        };
      if (method === "POST" && path === "/v1/profiles")
        return {
          status: 201,
          json: {
            data: {
              id: "p1",
              attributes: { profileContent: Buffer.from("PROFILE").toString("base64") },
            },
          },
        };
      return { status: 404, json: null };
    };
    const bytes = await makeProfile({
      api,
      identifier: "org.habiby.proscenium",
      certificateSha1: sha,
      name: "Proscenium Mac App Store 2026-10-19",
    });
    expect(bytes.toString()).toBe("PROFILE");
    expect(body(calls, "POST", "/v1/profiles")).toEqual({
      data: {
        type: "profiles",
        attributes: { name: "Proscenium Mac App Store 2026-10-19", profileType: "MAC_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: "mac" } },
          certificates: { data: [{ type: "certificates", id: "c1" }] },
        },
      },
    } as never);
    // A key App Store Connect lets make none says so, with its status.
    const refused = async (m: string, p: string) =>
      p.startsWith("/v1/profiles")
        ? { status: 403, json: { errors: [{ detail: "not allowed" }] } }
        : api(m, p);
    await expect(
      makeProfile({
        api: refused,
        identifier: "org.habiby.proscenium",
        certificateSha1: sha,
        name: "x",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

test("the version the record was made with is this release's, renamed: a store refuses a second open version", async () => {
  const s = asc({
    versions: [
      {
        id: "v0",
        attributes: {
          versionString: "1.0",
          appVersionState: "PREPARE_FOR_SUBMISSION",
          releaseType: "MANUAL",
        },
      },
    ],
    locs: [{ id: "loc1", attributes: { locale: "en-US" } }],
  });
  const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put });
  expect(done.steps[0]).toBe(`the open version 1.0 made ${SUBMIT.version}, on sale once approved`);
  expect(body(s.calls, "PATCH", "/v1/appStoreVersions/v0")?.data.attributes).toEqual({
    versionString: SUBMIT.version,
    releaseType: "AFTER_APPROVAL",
  });
  // No second version is asked for: App Store Connect answers that with 409.
  expect(s.calls.some(([m, p]) => m === "POST" && p === "/v1/appStoreVersions")).toBe(false);
  // A version already on sale or in review is never renamed: a new one is made.
  const live = asc({
    versions: [
      {
        id: "v9",
        attributes: { versionString: "1.0.2", appVersionState: "READY_FOR_DISTRIBUTION" },
      },
    ],
    locs: [{ id: "loc1", attributes: { locale: "en-US" } }],
  });
  await submitVersion({ ...SUBMIT, api: live.api, put: live.put });
  expect(live.calls.some(([m, p]) => m === "PATCH" && p === "/v1/appStoreVersions/v9")).toBe(false);
  expect(live.calls.some(([m, p]) => m === "POST" && p === "/v1/appStoreVersions")).toBe(true);
});

test("a version is put up for review only once App Store Connect has processed its screenshots, and a 409 while it settles is asked again", async () => {
  const waited: number[] = [];
  const wait = async (ms: number) => {
    waited.push(ms);
  };
  // The first screenshot still processing on the first look, then done.
  const s = asc({
    locs: [{ id: "loc1", attributes: { locale: "en-US" } }],
    delivery: [{ state: "UPLOAD_COMPLETE" }],
    busy: [true],
  });
  const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put, wait });
  expect(done.steps.at(-1)).toBe("submitted for App Review");
  // One wait for the screenshots, one for the 409 at the submission.
  expect(waited).toEqual([5000, 20000]);
  expect(
    s.calls.filter(([m, p]) => m === "POST" && p === "/v1/reviewSubmissionItems"),
  ).toHaveLength(2);
});

test("a screenshot App Store Connect could not process, or one never processed, stops the submission and says so", async () => {
  const wait = async () => {};
  const failed = asc({
    delivery: [
      {
        state: "FAILED",
        errors: [{ code: "IMAGE_INCORRECT_DIMENSIONS", description: "The dimensions are wrong." }],
      },
    ],
  });
  await expect(
    replaceScreenshots({
      api: failed.api,
      put: failed.put,
      localization: "loc1",
      shots: SHOTS,
      wait,
    }),
  ).rejects.toThrow("App Store Connect could not process a screenshot: The dimensions are wrong.");
  const slow = asc({ delivery: Array.from({ length: 200 }, () => ({ state: "UPLOAD_COMPLETE" })) });
  await expect(
    replaceScreenshots({
      api: slow.api,
      put: slow.put,
      localization: "loc1",
      shots: SHOTS,
      wait,
      tries: 3,
    }),
  ).rejects.toThrow(/had not processed the screenshots after 15 s/);
});

test("a refusal says what Apple named under it, not only that it refused", async () => {
  const s = asc({
    locs: [{ id: "loc1", attributes: { locale: "en-US" } }],
    busy: [true, true, true, true],
  });
  await expect(
    submitVersion({ ...SUBMIT, api: s.api, put: s.put, wait: async () => {} }),
  ).rejects.toThrow(
    "put in the submission: App Store Connect answered 409: This resource cannot be reviewed, please check associated errors to see why.; The screenshot is still being processed.",
  );
});

test("a version an earlier attempt left in a review submission, unsent, is sent as it is: nothing edited, nothing added", async () => {
  const s = asc({
    versions: [
      {
        id: "v1",
        attributes: {
          versionString: SUBMIT.version,
          appVersionState: "READY_FOR_REVIEW",
          releaseType: "AFTER_APPROVAL",
        },
      },
    ],
    submissions: [{ id: "s1" }],
    items: [{ relationships: { appStoreVersion: { data: { id: "v1" } } } }],
  });
  const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put, wait: async () => {} });
  expect(done.steps).toEqual([
    `${SUBMIT.version} already in a review submission: sent as it is`,
    "submitted for App Review",
  ]);
  expect(s.calls.some(([, p]) => p.endsWith("/relationships/build"))).toBe(false);
  expect(
    s.calls.some(([m, p]) => m === "PATCH" && p.startsWith("/v1/appStoreVersionLocalizations/")),
  ).toBe(false);
  expect(s.calls.some(([m, p]) => m === "POST" && p === "/v1/reviewSubmissionItems")).toBe(false);
  expect(body(s.calls, "PATCH", "/v1/reviewSubmissions/s1")?.data.attributes).toEqual({
    submitted: true,
  });
  // On sale is still nothing to submit.
  const onSale = asc({
    versions: [
      {
        id: "v1",
        attributes: { versionString: SUBMIT.version, appVersionState: "READY_FOR_DISTRIBUTION" },
      },
    ],
  });
  await expect(submitVersion({ ...SUBMIT, api: onSale.api, put: onSale.put })).rejects.toThrow(
    "is READY_FOR_DISTRIBUTION in App Store Connect: there is nothing to submit",
  );
});

test("a version sent already with this release's build is its submission, found and kept, nothing sent again; with another build, refused", async () => {
  const s = asc({
    versions: [
      {
        id: "v1",
        attributes: { versionString: SUBMIT.version, appVersionState: "WAITING_FOR_REVIEW" },
      },
    ],
    submissions: [{ id: "s1" }],
  });
  const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put });
  expect(done).toMatchObject({
    version: "v1",
    build: "b1",
    submission: "s1",
    state: "WAITING_FOR_REVIEW",
  });
  expect(done.steps).toEqual([
    `${SUBMIT.version} already submitted for App Review with build ${SUBMIT.build}: WAITING_FOR_REVIEW`,
  ]);
  // Only read: nothing written, nothing sent.
  expect(s.calls.filter(([m]) => m !== "GET")).toEqual([]);
});

test("the submission's items are read with the version each holds, and one App Store Connect says is in already counts as in", async () => {
  const s = asc({
    locs: [{ id: "loc1", attributes: { locale: "en-US" } }],
    submissions: [{ id: "s1" }],
    // The item is there, but the listing did not say which version it holds.
    items: [{ id: "i1" }],
    alreadyThere: true,
  });
  const done = await submitVersion({ ...SUBMIT, api: s.api, put: s.put, wait: async () => {} });
  expect(done.steps.at(-1)).toBe("submitted for App Review");
  expect(
    s.calls.some(
      ([m, p]) => m === "GET" && p === "/v1/reviewSubmissions/s1/items?include=appStoreVersion",
    ),
  ).toBe(true);
  // Asked once, told it was there, and not asked again.
  expect(
    s.calls.filter(([m, p]) => m === "POST" && p === "/v1/reviewSubmissionItems"),
  ).toHaveLength(1);
});
