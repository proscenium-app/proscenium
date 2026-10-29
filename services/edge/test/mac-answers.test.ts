// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Every answer the Worker gives a Mac, pinned.
 *
 * Each check on each route, chip, version and OS header, each download, each
 * refusal, in each state the update service can be in (a release out, one
 * published and not yet admitted, one admitted by the list, a halt, a track's
 * halt, GitHub or R2 failing), with what each state left counted in D1 and
 * what the Worker said; and which usage batches and crash reports from a Mac
 * it takes. All of it was recorded from the Worker as it was before it learned
 * any other platform, in test/fixtures/mac-answers.json: each answer's status,
 * headers and body, byte for byte. This file holds the Worker to that record.
 *
 *   MAC_ANSWERS_WRITE=1 bun test test/mac-answers.test.ts
 *
 * writes the record from the Worker as it is now: only for a change that means
 * to change what a Mac is told, and its commit says so.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { parseEnvelope } from "../src/crashes";
import { counts, REPORTS, type ReportsEnv } from "../src/reports";
import { GITHUB, TRACK_KEY_HEADER, UPDATES, updates, type Env } from "../src/updates";
import { admissionList, lists } from "./lists";

const RECORD = new URL("./fixtures/mac-answers.json", import.meta.url);
const WRITE = process.env.MAC_ANSWERS_WRITE === "1";
const KEY = `${"k".repeat(22)}Ey_-0123456789abcdefg`;
const KEY_SHA256 = createHash("sha256").update(KEY).digest("hex");
const NOW = new Date("2026-09-18T12:34:56Z");
const migrations = await Promise.all(
  ["0001_updates.sql", "0003_usage.sql", "0006_usage_track.sql", "0008_update_kinds.sql"].map((f) =>
    Bun.file(new URL(`../migrations/${f}`, import.meta.url)).text(),
  ),
);

type Entries = Record<string, { signature: string; url: string; [field: string]: string }>;
/**
 * Windows' part broken, each the way a pipeline could leave it
 * (docs/engineering/services-and-feedback.md#SERV-283): never a Mac's concern.
 */
const BROKEN: Record<string, (part: Entries) => void> = {
  "one chip without the other": (p) => delete p["windows-aarch64"],
  "an installer elsewhere": (p) => {
    p["windows-x86_64"].url = "https://elsewhere.test/Proscenium-setup.exe";
  },
  "the other chip's installer": (p) => {
    p["windows-aarch64"].url = p["windows-x86_64"].url;
  },
  "a signature that is not one": (p) => {
    p["windows-x86_64"].signature = "not a signature";
  },
  "an entry with a field more": (p) => {
    p["windows-aarch64"].size = "1";
  },
  "an installer's own key beside them": (p) => {
    p["windows-x86_64-nsis"] = { ...p["windows-x86_64"] };
  },
  "a system we do not build": (p) => {
    p["linux-x86_64"] = { ...p["windows-x86_64"] };
  },
};
/**
 * What the world holds beside the Mac's builds. `mac` is the Mac alone, as
 * every manifest was before Windows; `windows` names Windows' two installers in
 * every manifest too, a release's and a track's, ahead of the Mac's entries;
 * any of BROKEN's names breaks that Windows part so.
 */
type Platforms = "mac" | "windows" | keyof typeof BROKEN;

const signature = (c: string) => c.repeat(100);
/** Windows' two entries, an installer per chip, at `base`'s download address, broken as `platforms` says. */
function windowsEntries(base: string, version: string, platforms: Platforms): Entries {
  if (platforms === "mac") return {};
  const part: Entries = {
    "windows-x86_64": {
      signature: signature("w"),
      url: `${base}/download/v${version}/Proscenium_${version}_x64-setup.exe`,
    },
    "windows-aarch64": {
      signature: signature("v"),
      url: `${base}/download/v${version}/Proscenium_${version}_arm64-setup.exe`,
    },
  };
  BROKEN[platforms]?.(part);
  return part;
}
/** A release's manifest as GitHub serves it: universal, for every Mac. */
function release(version: string, platforms: Platforms) {
  const url = `${GITHUB}/download/v${version}/Proscenium_${version}_universal.app.tar.gz`;
  return {
    version,
    notes: `Proscenium ${version}.`,
    pub_date: "2026-09-18T12:00:00Z",
    platforms: {
      ...windowsEntries(GITHUB, version, platforms),
      "darwin-aarch64": { signature: signature("a"), url },
      "darwin-x86_64": { signature: signature("a"), url },
    },
  };
}
/** A track's manifest as the pipeline writes it to R2: universal (alpha's first builds) or Apple silicon's. */
function trackManifest(
  track: string,
  version: string,
  slice: "universal" | "aarch64",
  platforms: Platforms,
) {
  const base = `${UPDATES}/v1/${track}`;
  const url = `${base}/download/v${version}/Proscenium_${version}_${slice}.app.tar.gz`;
  const mac =
    slice === "universal"
      ? {
          "darwin-aarch64": { signature: signature("b"), url },
          "darwin-x86_64": { signature: signature("b"), url },
        }
      : { "darwin-aarch64": { signature: signature("c"), url } };
  return {
    version,
    notes: "Unreleased.",
    pub_date: "2026-09-26T20:00:00Z",
    platforms: { ...windowsEntries(base, version, platforms), ...mac },
  };
}

interface State {
  /** GitHub's releases, the last one newest; null when GitHub cannot be reached, a status when it refuses. */
  github: string[] | number | null;
  /** The admission list in R2, as the release writes it; none when undefined. */
  admission?: string;
  /** R2 failing to answer. */
  r2Down?: boolean;
}
/** The states the service can be in, each a world of its own. */
const STATES: Record<string, State> = {
  released: { github: ["0.9.0", "0.9.1"] },
  "published, not admitted": { github: ["0.9.0", "0.9.1", "0.9.2"] },
  "admitted by the list": {
    github: ["0.9.0", "0.9.1", "0.9.2"],
    admission: admissionList(["0.9.2"]),
  },
  "the newest halted": {
    github: ["0.9.0", "0.9.1", "0.9.2"],
    admission: admissionList(["0.9.2"], [{ version: "0.9.2", track: "stable" }]),
  },
  "the newest halted, GitHub refusing": {
    github: 503,
    admission: admissionList(["0.9.2"], [{ version: "0.9.2", track: "stable" }]),
  },
  "a track's newest halted": {
    github: ["0.9.0", "0.9.1"],
    admission: admissionList(
      [],
      [
        { version: "1.0.1-alpha.58", track: "alpha" },
        { version: "1.0.1-beta.2", track: "beta" },
      ],
    ),
  },
  "GitHub unreachable": { github: null },
  "R2 unreachable": { github: ["0.9.0", "0.9.1"], r2Down: true },
};

/** R2's objects: alpha's universal builds and beta's Apple-silicon ones, as published. */
function objects(platforms: Platforms, state: State): Map<string, string> {
  const o = new Map<string, string>();
  const alpha = "1.0.1-alpha.58";
  o.set("alpha/versions.json", JSON.stringify(["1.0.1-alpha.56", "1.0.1-alpha.57", alpha]));
  o.set("alpha/latest.json", JSON.stringify(trackManifest("alpha", alpha, "universal", platforms)));
  for (const suffix of [".app.tar.gz", ".app.tar.gz.sig", ".dmg"])
    o.set(`alpha/${alpha}/Proscenium_${alpha}_universal${suffix}`, `alpha ${suffix}`);
  const beta = "1.0.1-beta.2";
  o.set("beta/versions.json", JSON.stringify(["1.0.1-beta.1", beta]));
  o.set("beta/latest.json", JSON.stringify(trackManifest("beta", beta, "aarch64", platforms)));
  for (const suffix of [".app.tar.gz", ".app.tar.gz.sig", ".dmg"])
    o.set(`beta/${beta}/Proscenium_${beta}_aarch64${suffix}`, `beta ${suffix}`);
  if (platforms !== "mac")
    for (const [track, version] of [
      ["alpha", alpha],
      ["beta", beta],
    ])
      for (const chip of ["x64", "arm64"])
        for (const suffix of ["", ".sig"])
          o.set(
            `${track}/${version}/Proscenium_${version}_${chip}-setup.exe${suffix}`,
            `${track} ${chip}${suffix}`,
          );
  if (state.admission !== undefined) o.set("admission.json", state.admission);
  return o;
}

/** A world in one state: the Worker's bindings and dependencies over it, and what it counted and said. */
function world(state: State, platforms: Platforms) {
  const db = new Database(":memory:");
  for (const sql of migrations) db.exec(sql);
  const r2 = lists(objects(platforms, state));
  const said: string[] = [];
  const allow = {
    async limit() {
      return { success: true };
    },
  };
  const env: Env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: (string | number)[]) {
            return {
              async run() {
                db.query(sql).run(...args);
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
    UPDATE_LIMIT: allow,
    DOWNLOAD_LIMIT: allow,
    UPDATES_ENABLED: "true",
    DOWNLOADS_ENABLED: "true",
    RELEASED_VERSIONS_JSON: '["0.9.0","0.9.1"]',
    TRACKS: state.r2Down
      ? ({
          async get() {
            throw new Error("R2 unavailable");
          },
        } as unknown as Env["TRACKS"])
      : r2.source.bucket,
    ALPHA_KEY_SHA256: KEY_SHA256,
  };
  const published = state.github;
  async function fetch(r: Request): Promise<Response> {
    if (published === null) throw new Error("Network connection lost.");
    if (typeof published === "number") return new Response(null, { status: published });
    const path = new URL(r.url).pathname;
    if (path.endsWith("/latest/download/latest.json"))
      return Response.json(release(published[published.length - 1], platforms));
    const [, version, file] = /\/download\/v([^/]+)\/([^/]+)$/.exec(path) ?? [];
    if (version === undefined || !published.includes(version))
      return new Response(null, { status: 404 });
    return file === "latest.json"
      ? Response.json(release(version, platforms))
      : new Response(`${version} ${file}`);
  }
  const deps = {
    updatesOrigin: UPDATES,
    github: GITHUB,
    prefix: "",
    log: (line: string) => said.push(line),
    now: () => NOW,
    cache: r2.source.cache,
    fetch,
  };
  return {
    ask: (request: Request) => updates(request, env, deps),
    counted: () =>
      db
        .query(
          "SELECT kind, platform, arch, version, os, count FROM update_counts ORDER BY kind, platform, arch, version, os",
        )
        .all(),
    said,
  };
}

interface Ask {
  /** How the record names it. */
  name: string;
  request: Request;
}
function get(path: string, os: string | null = "14.6", key = false, origin = UPDATES): Request {
  const headers: Record<string, string> = { "CF-Connecting-IP": "192.0.2.100" };
  if (os !== null) headers["Proscenium-OS"] = os;
  if (key) headers[TRACK_KEY_HEADER] = KEY;
  return new Request(`${origin}${path}`, { headers });
}
/** Every request a Mac makes, or could, in the order each world is asked. */
function asks(): Ask[] {
  const out: Ask[] = [];
  const add = (name: string, request: Request) => out.push({ name, request });
  // Checks: every route, both chips, a version of each kind, with and without alpha's key.
  for (const route of ["/v1", "/v1/stable", "/v1/beta", "/v1/alpha"])
    for (const arch of ["aarch64", "x86_64"])
      for (const version of ["0.9.0", "0.9.2", "1.0.1-alpha.57", "1.0.1-beta.1", "9.9.9"])
        for (const key of [false, true])
          add(
            `${route}/darwin/${arch}/${version}${key ? " key" : ""}`,
            get(`${route}/darwin/${arch}/${version}`, "14.6", key),
          );
  // The OS header: a Mac's major.minor from 14, and anything else.
  for (const route of ["/v1", "/v1/beta"])
    for (const os of ["26.0", "15.10", "13.6", "14.6.1", "10.0.26100", "my machine", "", null])
      add(
        `${route}/darwin/aarch64/0.9.0 os:${os === null ? "none" : JSON.stringify(os)}`,
        get(`${route}/darwin/aarch64/0.9.0`, os),
      );
  // A release's files, under both of stable's names.
  for (const route of ["/v1/download", "/v1/stable/download"])
    for (const file of [
      "v0.9.1/Proscenium_0.9.1_universal.app.tar.gz",
      "v0.9.1/Proscenium_0.9.1_universal.app.tar.gz.sig",
      "v0.9.1/Proscenium_0.9.1_universal.dmg",
      "v0.9.2/Proscenium_0.9.2_universal.dmg",
      "v0.9.1/Proscenium_0.9.1_aarch64.app.tar.gz",
      "v0.9.1/Proscenium_0.9.0_universal.dmg",
      "v0.9.1/secret.txt",
      "v9.9.9/Proscenium_9.9.9_universal.dmg",
    ])
      add(`${route}/${file}`, get(`${route}/${file}`));
  // A track's files: its own, a version's gone, another track's, unpublished, the wrong slice.
  for (const key of [false, true])
    for (const file of [
      "alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz",
      "alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz.sig",
      "alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg",
      "alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_aarch64.app.tar.gz",
      "alpha/download/v1.0.1-alpha.56/Proscenium_1.0.1-alpha.56_universal.dmg",
      "alpha/download/v1.0.1-alpha.99/Proscenium_1.0.1-alpha.99_universal.dmg",
      "alpha/download/v0.9.1/Proscenium_0.9.1_universal.dmg",
      "beta/download/v1.0.1-beta.2/Proscenium_1.0.1-beta.2_aarch64.app.tar.gz",
      "beta/download/v1.0.1-beta.2/Proscenium_1.0.1-beta.2_aarch64.app.tar.gz.sig",
      "beta/download/v1.0.1-beta.2/Proscenium_1.0.1-beta.2_aarch64.dmg",
      "beta/download/v1.0.1-beta.2/Proscenium_1.0.1-beta.2_universal.dmg",
      "beta/download/v1.0.1-beta.1/Proscenium_1.0.1-beta.1_aarch64.dmg",
      "beta/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg",
      "beta/download/v1.0.1-beta.2/secret.txt",
    ])
      add(`/v1/${file}${key ? " key" : ""}`, get(`/v1/${file}`, "14.6", key));
  // What only a stranger asks.
  for (const path of [
    "/",
    "/admin",
    "/v1/darwin/aarch64",
    "/v1/darwin/arm64/0.9.0",
    "/v1/macos/aarch64/0.9.0",
    "/v1/nightly/darwin/aarch64/0.9.0",
    "/v1/Alpha/darwin/aarch64/1.0.1-alpha.57",
    "/v1/darwin/aarch64/0.9.0?secret=1",
  ])
    add(path, get(path));
  add(
    "POST /v1/darwin/aarch64/0.9.0",
    new Request(get("/v1/darwin/aarch64/0.9.0"), { method: "POST" }),
  );
  add(
    "https://elsewhere.test/v1/darwin/aarch64/0.9.0",
    get("/v1/darwin/aarch64/0.9.0", "14.6", false, "https://elsewhere.test"),
  );
  return out;
}

/** The record's tables: each distinct set of headers and each distinct body once. */
class Tables {
  headers: [string, string][][] = [];
  bodies: string[] = [];
  private index<T>(list: T[], value: T): number {
    const text = JSON.stringify(value);
    const at = list.findIndex((v) => JSON.stringify(v) === text);
    if (at !== -1) return at;
    list.push(value);
    return list.length - 1;
  }
  async entry(r: Response): Promise<string> {
    const headers = [...r.headers].sort(([a], [b]) => a.localeCompare(b));
    return `${r.status} h${this.index(this.headers, headers)} b${this.index(this.bodies, await r.text())}`;
  }
}
interface WorldRecord {
  answers: Record<string, string>;
  counted: unknown[];
  said: string[];
}
interface Pinned {
  worlds: Record<string, WorldRecord>;
  reports: Record<string, number>;
  crashes: Record<string, string>;
  headers: [string, string][][];
  bodies: string[];
}

/** Each world asked every Mac request, in order: what it answered, counted and said. */
async function answered(
  platforms: Platforms,
  tables: Tables,
): Promise<Record<string, WorldRecord>> {
  const worlds: Record<string, WorldRecord> = {};
  for (const [name, state] of Object.entries(STATES)) {
    const w = world(state, platforms);
    const answers: Record<string, string> = {};
    for (const a of asks()) answers[a.name] = await tables.entry(await w.ask(a.request));
    worlds[name] = { answers, counted: w.counted(), said: [...w.said] };
  }
  return worlds;
}

/** One field's values, each a change to make. */
const each = (field: string, values: string[]): [string, string][] => values.map((v) => [field, v]);

/** A Mac's usage batch, one dimension changed, and the status it is answered. */
async function reports(): Promise<Record<string, number>> {
  const db = new Database(":memory:");
  for (const sql of migrations) db.exec(sql);
  const env: ReportsEnv = {
    EVENTS_ENABLED: "true",
    RELEASED_VERSIONS_JSON: '["0.9.0","1.0.0"]',
    EVENTS_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: (string | number)[]) {
            return { sql, args };
          },
        };
      },
      async batch(statements: { sql: string; args: (string | number)[] }[]) {
        return db.transaction(() =>
          statements.map((s) => {
            db.query(s.sql).run(...s.args);
            return { success: true };
          }),
        )();
      },
    } as unknown as D1Database,
  };
  const { source } = lists(
    new Map([
      ["beta/versions.json", JSON.stringify(["1.0.1-beta.1"])],
      ["alpha/versions.json", JSON.stringify(["1.0.1-alpha.57"])],
    ]),
  );
  const base = {
    version: "1.0.0",
    platform: "darwin",
    arch: "aarch64",
    os: "15.6",
    channel: "developer-id",
    events: [{ name: "app_launched", props: {} }],
  };
  const out: Record<string, number> = {};
  const changes = [
    ...each("version", ["1.0.0", "0.9.0", "1.0.1-beta.1", "1.0.1-alpha.57", "9.9.9"]),
    ...each("platform", ["darwin", "macos", "Darwin", "windows"]),
    ...each("arch", ["aarch64", "x86_64", "arm64", "x64"]),
    ...each("os", ["14.0", "15.6", "26.1", "99.99", "13.6", "15.6.1", "10.0.26100", "10.0", ""]),
    ...each("channel", [
      "developer-id",
      "app-store",
      "local",
      "store",
      "download",
      "microsoft-store",
    ]),
  ];
  for (const [field, value] of changes) {
    const body = { ...base, [field]: value };
    const r = await counts(
      new Request(`${REPORTS}/v1/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
      NOW,
      source,
    );
    out[`${field}: ${JSON.stringify(value)}`] = r.status;
  }
  return out;
}

/** A Mac's crash report, its system's tags changed, taken by the parser or refused. */
function crashes(): Record<string, string> {
  const encoder = new TextEncoder();
  const envelope = (tags: Record<string, unknown>) => {
    const id = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";
    const event = JSON.stringify({
      event_id: id.replaceAll("-", ""),
      level: "fatal",
      platform: "javascript",
      timestamp: Math.floor(NOW.getTime() / 86_400_000) * 86_400,
      release: "1.0.0",
      exception: {
        values: [
          {
            type: "TypeError",
            stacktrace: { frames: [{ module: "webview", lineno: 1, colno: 2 }] },
          },
        ],
      },
      tags,
    });
    return encoder.encode(
      `${JSON.stringify({ event_id: id })}\n${JSON.stringify({ type: "event", length: encoder.encode(event).byteLength })}\n${event}\n`,
    );
  };
  const base = { app_platform: "darwin", arch: "aarch64", os: "26.0" };
  const out: Record<string, string> = {};
  const changes = [
    ...each("app_platform", ["darwin", "macos", "windows"]),
    ...each("arch", ["aarch64", "x86_64", "arm64"]),
    ...each("os", ["14.0", "26.0", "13.6", "26.0.1", "10.0.26100", ""]),
  ];
  for (const [field, value] of changes) {
    let outcome = "taken";
    try {
      parseEnvelope(envelope({ ...base, [field]: value }), NOW);
    } catch {
      outcome = "refused";
    }
    out[`${field}: ${JSON.stringify(value)}`] = outcome;
  }
  return out;
}

const recorded: Pinned | null = WRITE ? null : JSON.parse(await Bun.file(RECORD).text());

describe("every answer a Mac is given", () => {
  if (WRITE)
    test("is recorded from the Worker as it is now", async () => {
      const tables = new Tables();
      const record: Pinned = {
        worlds: await answered("mac", tables),
        reports: await reports(),
        crashes: crashes(),
        headers: tables.headers,
        bodies: tables.bodies,
      };
      await Bun.write(RECORD, `${JSON.stringify(record, null, 2)}\n`);
    });
  else {
    const pinned = recorded as Pinned;
    /** An answer, read back through the record's tables. */
    const read = (entry: string, tables: { headers: unknown[]; bodies: string[] }) => {
      const [status, h, b] = entry.split(" ");
      return {
        status: Number(status),
        headers: tables.headers[Number(h.slice(1))],
        body: tables.bodies[Number(b.slice(1))],
      };
    };
    test("the record covers every state and every request", () => {
      expect(Object.keys(pinned.worlds)).toEqual(Object.keys(STATES));
      for (const w of Object.values(pinned.worlds))
        expect(Object.keys(w.answers)).toEqual(asks().map((a) => a.name));
    });
    // Each world's every answer, count and line against the record.
    const held = async (platforms: Platforms) => {
      const tables = new Tables();
      const now = await answered(platforms, tables);
      for (const [name, w] of Object.entries(pinned.worlds)) {
        for (const [request, entry] of Object.entries(w.answers))
          expect(read(now[name].answers[request], tables), `${name}: ${request}`).toEqual(
            read(entry, pinned),
          );
        expect(now[name].counted, name).toEqual(w.counted);
        expect(now[name].said, name).toEqual(w.said);
      }
    };
    test("with every manifest the Mac's alone, as the record was made", () => held("mac"));
    // docs/engineering/services-and-feedback.md#SERV-283: one manifest serves both
    // systems, and a Mac's answer cannot tell whether it names Windows.
    test("with every manifest naming Windows beside the Mac, a release's and a track's", () =>
      held("windows"));
    // Each system is judged on its own part alone: the Mac never waits on Windows,
    // and no broken Windows part changes a Mac's answer.
    for (const broken of Object.keys(BROKEN))
      test(`with every manifest's Windows part broken: ${broken}`, () => held(broken));
    test("a Mac's usage batches and crash reports are taken and refused as recorded", async () => {
      expect(await reports()).toEqual(pinned.reports);
      expect(crashes()).toEqual(pinned.crashes);
    });
  }
});
