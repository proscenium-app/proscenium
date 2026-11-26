// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { storeNotes } from "./app-store-connect.mjs";
import {
  NOTES_LIMIT,
  apiOf,
  certificationOf,
  certificationState,
  futureFamiliesOf,
  inFlight,
  msToken,
  pricingOf,
  submitPackages,
  updatedSubmission,
} from "./ms-store.mjs";

const STORE = "9NDS1KZGM7QJ";
const BASE = `/v1.0/my/applications/${STORE}`;

type Sub = Record<string, unknown> & { id: string; status: string };

/** A published submission of `version`, as Partner Center keeps one. */
function publishedOf(version: string, id = "100"): Sub {
  return {
    id,
    status: "Published",
    pricing: { priceId: "Base", trialPeriod: "NoFreeTrial" },
    targetPublishMode: "Immediate",
    listings: { "en-us": { baseListing: { title: "Proscenium: Playwriting", releaseNotes: "" } } },
    applicationPackages: [
      {
        id: "p1",
        fileName: `Proscenium_${version}_x64.msix`,
        fileStatus: "Uploaded",
        version: `${version}.0`,
      },
      {
        id: "p2",
        fileName: `Proscenium_${version}_arm64.msix`,
        fileStatus: "Uploaded",
        version: `${version}.0`,
      },
    ],
  };
}

/**
 * Partner Center, played: the product with its last published and pending
 * submissions, a new one cloned from the last published on POST, and the
 * status a commit leads to. Every call is kept.
 */
function partner({
  published = publishedOf("1.0.4"),
  pending = null as Sub | null,
  afterCommit = ["CommitStarted", "PreProcessing"],
  refuse = {} as Record<string, number>,
} = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const subs: Record<string, Sub> = { [published.id]: published };
  if (pending) subs[pending.id] = pending;
  let pendingId = pending?.id ?? null;
  let statuses = [...afterCommit];
  const put: { url: string; bytes: Uint8Array }[] = [];
  const api = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (refuse[key]) return { status: refuse[key], json: { code: "InvalidState", message: "no" } };
    if (method === "GET" && path === BASE)
      return {
        status: 200,
        json: {
          id: STORE,
          lastPublishedApplicationSubmission: { id: published.id },
          pendingApplicationSubmission: pendingId ? { id: pendingId } : null,
        },
      };
    const m =
      /^\/v1\.0\/my\/applications\/[^/]+\/submissions(?:\/(\d+))?(\/status|\/commit)?$/.exec(path);
    if (!m) return { status: 404, json: null };
    const [, id, tail] = m;
    if (method === "POST" && !id) {
      const made: Sub = {
        ...structuredClone(published),
        id: "200",
        status: "PendingCommit",
        fileUploadUrl: "https://blob.example/ingestion/200?sig=a+b",
      };
      subs[made.id] = made;
      pendingId = made.id;
      return { status: 201, json: made };
    }
    if (method === "DELETE" && id) {
      delete subs[id];
      if (pendingId === id) pendingId = null;
      return { status: 204, json: null };
    }
    if (method === "PUT" && id) {
      subs[id] = { ...(body as Sub), id, status: subs[id].status };
      return { status: 200, json: subs[id] };
    }
    if (method === "POST" && tail === "/commit") {
      subs[id].status = "CommitStarted";
      return { status: 202, json: { status: "CommitStarted" } };
    }
    if (method === "GET" && tail === "/status") {
      const status = statuses.length > 1 ? (statuses.shift() as string) : statuses[0];
      subs[id].status = status;
      return {
        status: 200,
        json: {
          status,
          statusDetails: {
            errors: status.endsWith("Failed")
              ? [{ code: "InvalidPackage", details: "the package is broken" }]
              : [],
            warnings: [],
            certificationReports: [],
          },
        },
      };
    }
    if (method === "GET" && id)
      return subs[id] ? { status: 200, json: subs[id] } : { status: 404, json: null };
    return { status: 400, json: null };
  };
  return {
    api,
    calls,
    subs,
    put: async (url: string, bytes: Uint8Array) => put.push({ url, bytes }),
    uploads: put,
  };
}

const PACKAGES = [
  { name: "Proscenium_1.0.5_x64.msix", bytes: new Uint8Array([1, 2, 3]) },
  { name: "Proscenium_1.0.5_arm64.msix", bytes: new Uint8Array([4, 5]) },
];
const NOTES = "Fixed\n\n• A line.";
const zip = async (ps: { name: string }[]) =>
  new TextEncoder().encode(ps.map((p) => p.name).join(","));
const go = (p: ReturnType<typeof partner>, extra = {}) =>
  submitPackages({
    api: p.api,
    put: p.put,
    zip,
    storeId: STORE,
    version: "1.0.5",
    packages: PACKAGES,
    notes: NOTES,
    wait: async () => {},
    ...extra,
  });

describe("the Microsoft Store's submission (scripts/ms-store.mjs)", () => {
  test("a new submission: made from the last published, its data written, its archive uploaded, committed and taken", async () => {
    const p = partner();
    const done = await go(p);
    expect(done).toMatchObject({
      storeId: STORE,
      version: "1.0.5.0",
      submission: "200",
      status: "PreProcessing",
      page: `https://partner.microsoft.com/dashboard/products/${STORE}/submissions/200`,
    });
    expect(p.calls.map((c) => `${c.method} ${c.path.replace(BASE, "")}`)).toEqual([
      "GET ",
      "GET /submissions/100",
      "POST /submissions",
      "PUT /submissions/200",
      "POST /submissions/200/commit",
      "GET /submissions/200/status",
      "GET /submissions/200/status",
    ]);
    const body = p.calls.find((c) => c.method === "PUT")?.body as Sub;
    // The last release's packages go, this one's come; What's new, published at once, free.
    expect(body.applicationPackages).toEqual([
      expect.objectContaining({ id: "p1", fileStatus: "PendingDelete" }),
      expect.objectContaining({ id: "p2", fileStatus: "PendingDelete" }),
      {
        fileName: "Proscenium_1.0.5_x64.msix",
        fileStatus: "PendingUpload",
        minimumDirectXVersion: "None",
        minimumSystemRam: "None",
      },
      {
        fileName: "Proscenium_1.0.5_arm64.msix",
        fileStatus: "PendingUpload",
        minimumDirectXVersion: "None",
        minimumSystemRam: "None",
      },
    ]);
    expect(
      (body.listings as Record<string, { baseListing: { releaseNotes: string } }>)["en-us"]
        .baseListing.releaseNotes,
    ).toBe(NOTES);
    expect(body.pricing).toEqual({ priceId: "Free", trialPeriod: "NoFreeTrial" });
    expect(body.targetPublishMode).toBe("Immediate");
    expect(body).not.toHaveProperty("fileUploadUrl");
    expect(body).not.toHaveProperty("status");
    expect(p.uploads).toHaveLength(1);
    expect(p.uploads[0].url).toBe("https://blob.example/ingestion/200?sig=a+b");
    expect(new TextDecoder().decode(p.uploads[0].bytes)).toBe(
      "Proscenium_1.0.5_x64.msix,Proscenium_1.0.5_arm64.msix",
    );
  });

  test("this version published already, or on its way already: nothing is sent again", async () => {
    const p = partner({ published: publishedOf("1.0.5") });
    expect(await go(p)).toMatchObject({ submission: "100", status: "Published", already: true });
    expect(p.calls.some((c) => c.method !== "GET")).toBe(false);
    const q = partner({ pending: { ...publishedOf("1.0.5", "150"), status: "Certification" } });
    expect(await go(q)).toMatchObject({
      submission: "150",
      status: "Certification",
      already: true,
    });
    expect(q.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  test("another release's submission in certification is waited for, and nothing is changed", async () => {
    const p = partner({
      published: publishedOf("1.0.3"),
      pending: { ...publishedOf("1.0.4", "150"), status: "Certification" },
    });
    const done = await go(p);
    expect(done.submission).toBeNull();
    expect(done.waiting).toEqual({
      on: "submission",
      submission: "150",
      status: "Certification",
      version: "1.0.4.0",
      page: `https://partner.microsoft.com/dashboard/products/${STORE}/submissions/150`,
    });
    expect(p.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  test("a draft this API made, or one refused, is removed and made again; one made by hand is left as it is", async () => {
    for (const status of ["PendingCommit", "CommitFailed", "CertificationFailed", "Canceled"]) {
      const p = partner({
        pending: {
          ...publishedOf("1.0.5", "150"),
          status,
          fileUploadUrl: "https://blob.example/x",
        },
      });
      const done = await go(p);
      expect(done.submission).toBe("200");
      expect(p.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
        `${BASE}/submissions/150`,
      ]);
    }
    const hand = partner({ pending: { ...publishedOf("1.0.4", "150"), status: "PendingCommit" } });
    const done = await go(hand);
    expect(done.waiting).toMatchObject({ on: "draft", submission: "150" });
    expect(hand.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  test("a commit Partner Center refuses fails with its errors; one still committing after the wait is said as it is", async () => {
    const p = partner({ afterCommit: ["CommitStarted", "CommitFailed"] });
    await expect(go(p)).rejects.toThrow(
      "Partner Center refused submission 200 (CommitFailed): InvalidPackage: the package is broken",
    );
    const slow = partner({ afterCommit: ["CommitStarted"] });
    expect(await go(slow, { tries: 3 })).toMatchObject({
      submission: "200",
      status: "CommitStarted",
    });
  });

  test("a refusal says what was asked and what Partner Center answered", async () => {
    const p = partner({ refuse: { [`POST ${BASE}/submissions`]: 409 } });
    await expect(go(p)).rejects.toThrow(
      "a new submission: Partner Center answered 409: InvalidState; no",
    );
  });

  test("the first submission is a person's: a product never published is refused", async () => {
    const p = partner();
    const api = async (m: string, path: string, b?: unknown) =>
      m === "GET" && path === BASE ? { status: 200, json: { id: STORE } } : p.api(m, path, b);
    await expect(go({ ...p, api })).rejects.toThrow("the first is made by hand in Partner Center");
  });
});

describe("the submission's data, pure", () => {
  test("a price that cannot go back as it came goes as Free; any other as it came", () => {
    expect(pricingOf({ priceId: "Base", trialPeriod: "NoFreeTrial" })).toEqual({
      priceId: "Free",
      trialPeriod: "NoFreeTrial",
    });
    expect(pricingOf(null)).toEqual({ priceId: "Free" });
    expect(pricingOf({ priceId: "" })).toEqual({ priceId: "Free" });
    expect(pricingOf({ priceId: "Tier1012" })).toEqual({ priceId: "Tier1012" });
    expect(pricingOf({ priceId: "Free" })).toEqual({ priceId: "Free" });
  });

  test("every device family is answered, as the last release left it and no where it said nothing", () => {
    const all = { Desktop: false, Mobile: false, Xbox: false, Holographic: false };
    expect(futureFamiliesOf(undefined)).toEqual(all);
    expect(futureFamiliesOf({ Desktop: true })).toEqual({ ...all, Desktop: true });
    expect(futureFamiliesOf({ Desktop: true, Xbox: null, Mobile: "yes" })).toEqual({
      ...all,
      Desktop: true,
    });
    const clone = { ...publishedOf("1.0.4"), allowTargetFutureDeviceFamilies: { Desktop: true } };
    const body = updatedSubmission(clone, { files: ["Proscenium_1.0.5_x64.msix"], notes: "n" });
    expect(body.allowTargetFutureDeviceFamilies).toEqual({ ...all, Desktop: true });
    const none = updatedSubmission(publishedOf("1.0.4"), { files: ["a"], notes: "n" });
    expect(none.allowTargetFutureDeviceFamilies).toEqual(all);
  });

  test("What's new is held to Partner Center's limit, and an attempt's leftover package is added once", () => {
    const clone = {
      ...publishedOf("1.0.4"),
      applicationPackages: [
        ...(publishedOf("1.0.4").applicationPackages as unknown[]),
        { fileName: "Proscenium_1.0.5_x64.msix", fileStatus: "PendingUpload" },
      ],
    };
    const body = updatedSubmission(clone, { files: ["Proscenium_1.0.5_x64.msix"], notes: "n" });
    expect((body.applicationPackages as { fileStatus: string }[]).map((p) => p.fileStatus)).toEqual(
      ["PendingDelete", "PendingDelete", "PendingUpload"],
    );
    expect(() =>
      updatedSubmission(clone, { files: ["a"], notes: "x".repeat(NOTES_LIMIT + 1) }),
    ).toThrow("past 1500");
    expect(() => updatedSubmission(clone, { files: [], notes: "n" })).toThrow("its packages");
    expect(() =>
      updatedSubmission({ ...clone, listings: {} }, { files: ["a"], notes: "n" }),
    ).toThrow("no listing");
  });

  test("certification's states, as the release machine keeps them", () => {
    expect(certificationOf("Published")).toEqual({ state: "published", kind: null });
    for (const s of [
      "CommitFailed",
      "PreProcessingFailed",
      "CertificationFailed",
      "ReleaseFailed",
      "PublishFailed",
    ])
      expect(certificationOf(s)).toEqual({ state: "failed", kind: s });
    expect(certificationOf("Canceled").state).toBe("canceled");
    for (const s of [
      "CommitStarted",
      "PreProcessing",
      "Certification",
      "Release",
      "PendingPublication",
      "Publishing",
    ]) {
      expect(certificationOf(s).state).toBe("waiting");
      expect(inFlight(s)).toBe(true);
    }
    expect(inFlight("PendingCommit")).toBe(false);
  });

  test("a status read: its errors and certification reports said, with the submission's page", async () => {
    const api = async () => ({
      status: 200,
      json: {
        status: "CertificationFailed",
        statusDetails: {
          errors: [{ code: "PolicyViolation", details: "10.1" }],
          certificationReports: [{ date: "2026-10-30", reportUrl: "https://report.example/1" }],
        },
      },
    });
    expect(await certificationState({ api, storeId: STORE, submission: "200" })).toEqual({
      status: "CertificationFailed",
      state: "failed",
      kind: "CertificationFailed",
      errors: "PolicyViolation: 10.1; https://report.example/1",
      page: `https://partner.microsoft.com/dashboard/products/${STORE}/submissions/200`,
    });
  });
});

describe("Microsoft Entra's token", () => {
  const KEY = { tenantId: "t-1", clientId: "c-1", secret: "x".repeat(40) };

  test("asked once with the client's credentials for the API, and kept for its calls", async () => {
    const asked: { url: string; body: string; auth?: string }[] = [];
    const fetcher = async (
      url: string,
      init: { body?: string; headers?: Record<string, string> },
    ) => {
      asked.push({ url, body: String(init.body ?? ""), auth: init.headers?.Authorization });
      if (url.startsWith("https://login.microsoftonline.com/"))
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      return new Response("{}", { status: 200 });
    };
    const api = apiOf(KEY, { fetcher: fetcher as typeof fetch });
    await api("GET", "/v1.0/my/applications/X");
    await api("GET", "/v1.0/my/applications/X");
    expect(asked.map((a) => a.url)).toEqual([
      "https://login.microsoftonline.com/t-1/oauth2/token",
      "https://manage.devcenter.microsoft.com/v1.0/my/applications/X",
      "https://manage.devcenter.microsoft.com/v1.0/my/applications/X",
    ]);
    const form = new URLSearchParams(asked[0].body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("resource")).toBe("https://manage.devcenter.microsoft.com");
    expect(asked[1].auth).toBe("Bearer tok");
  });

  test("a refusal names Entra's code and never the secret", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "AADSTS7000222: The provided client secret keys are expired.",
        }),
        { status: 401 },
      );
    let message = "";
    try {
      await msToken(KEY, { fetcher: fetcher as typeof fetch });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      "Microsoft Entra refused the Store key (401, invalid_client, AADSTS7000222)",
    );
    expect(message).not.toContain(KEY.secret);
  });
});

describe("What's new for the Microsoft Store (scripts/app-store-connect.mjs storeNotes)", () => {
  const MD = [
    "### Added",
    "",
    "- Proscenium runs on Windows: the same app, from the Microsoft Store.",
    "- On the Mac, Finder's Open With lists Proscenium.",
    "",
    "### Fixed",
    "",
    "- The updater on the Beta track checks once a day.",
    "- A page break puts the next line at the top of the new page.",
  ].join("\n");

  test("the Mac's lines and the download's go; Windows' stay", () => {
    expect(storeNotes(MD, { store: "windows" })).toBe(
      "Added\n\n• Proscenium runs on Windows: the same app, from the Microsoft Store.\n\nFixed\n\n• A page break puts the next line at the top of the new page.",
    );
    // The Mac App Store's copy keeps the Mac's line and drops Windows'.
    expect(storeNotes(MD)).toBe(
      "Added\n\n• On the Mac, Finder's Open With lists Proscenium.\n\nFixed\n\n• A page break puts the next line at the top of the new page.",
    );
  });

  test("past 1500 characters it is cut at a whole line, never after a heading", () => {
    const long = [
      "### Added",
      "",
      ...Array.from({ length: 30 }, (_, i) => `- Item ${i}: ${"word ".repeat(12)}`),
      "",
      "### Fixed",
      "",
      "- last",
    ].join("\n");
    const said = storeNotes(long, { store: "windows" }) as string;
    expect(said.length).toBeLessThanOrEqual(1500);
    expect(said.endsWith("\n…")).toBe(true);
    const lines = said.split("\n");
    expect(lines.at(-2)?.startsWith("• Item ")).toBe(true);
    expect(() => storeNotes(MD, { store: "nowhere" })).toThrow("no store nowhere");
  });
});
