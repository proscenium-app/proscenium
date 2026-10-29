// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Public update transport. Request headers, addresses and individual requests never reach D1.
 *
 * Stable comes from GitHub's releases. Alpha and beta come from R2, where the
 * pipeline writes each track's manifest, its list of every version it has
 * published, and each version's files (docs/engineering/services-and-feedback.md#SERV-249).
 * Alpha answers only a request that holds its key; to anything else it is the
 * bare 404 of a track that does not exist.
 *
 * Intel Macs take stable releases alone (docs/engineering/services-and-feedback.md#SERV-265):
 * a track build is Apple silicon's, so its manifest may name `darwin-aarch64`
 * alone, and an Intel copy that still asks alpha or beta (one built before the
 * app offered Intel stable only) is answered as stable answers it. The rule is
 * the Mac's alone: an x86_64 Windows copy is not an Intel Mac.
 *
 * Windows is a second system beside the Mac
 * (docs/engineering/services-and-feedback.md#SERV-283): a manifest names the
 * Mac's builds as before, and may name Windows' two installers beside them, so
 * one manifest serves both. Each copy is judged on its own system's part
 * alone and answered with that part's entries, so a Mac's answer is the same
 * whether a manifest names Windows or not, or names it wrongly; a Windows copy
 * hears nothing newer from a manifest that names only the Mac, and 502 from
 * one whose Windows part is broken.
 *
 * What is released comes from lists, and one function answers for every route
 * ([`releasedOn`], docs/engineering/services-and-feedback.md#SERV-269): stable's
 * deployed list, the admission list a release writes to R2 with no deploy
 * (docs/engineering/services-and-feedback.md#SERV-268), and each track's list
 * of what it has published. A halt in the admission list stops the offer of a
 * version and deletes nothing (docs/engineering/services-and-feedback.md#SERV-270).
 */
export const REPOSITORY = "proscenium-app/proscenium";
export const GITHUB = `https://github.com/${REPOSITORY}/releases`;
export const UPDATES = "https://updates.proscenium.ink";
/** A release: `X.Y.Z`. */
export const VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
/** A track build's whole version, which names its track: `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`. */
export const TRACK_VERSION =
  /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})-(alpha|beta)\.(0|[1-9]\d{0,8})$/;
export type Track = "alpha" | "beta";
/** Where a version is released: stable, or the track its whole version names. */
export type Channel = "stable" | Track;
/** The header an alpha copy's key travels in, beside `Proscenium-OS`, on alpha's requests and nothing else. */
export const TRACK_KEY_HEADER = "Proscenium-Track-Key";
/** A key as scripts/track-key.mjs makes it: 32 random bytes, base64url, unpadded. */
export const TRACK_KEY = /^[A-Za-z0-9_-]{43}$/;
/** The admission list's key, at the root of the Worker's keys (docs/engineering/services-and-feedback.md#SERV-268). */
export const ADMISSION = "admission.json";
/**
 * The systems a copy runs on, as the updater names them in its address and a
 * manifest names them in its keys (docs/engineering/services-and-feedback.md#SERV-282).
 */
export const SYSTEMS = ["darwin", "windows"] as const;
export type System = (typeof SYSTEMS)[number];
/** The chips, as the updater names them, on either system. */
export const ARCHES = ["aarch64", "x86_64"] as const;
/**
 * The system's version a copy names, in its check's `Proscenium-OS` and in a
 * report's `os` (docs/engineering/services-and-feedback.md#SERV-282): a Mac's
 * `<major>.<minor>`, from macOS 14; Windows' `10.0.<build>`, from Windows 10
 * 22H2's build 19045 (Windows 11 is 10.0 too, from build 22000). Anything
 * finer, a patch or Windows' update revision, is not sent.
 */
const SYSTEM_VERSION: Record<System, RegExp> = {
  darwin: /^(1[4-9]|[2-9]\d)\.(0|[1-9]\d?)$/,
  windows: /^10\.0\.(1904[5-9]|190[5-9]\d|19[1-9]\d\d|[2-9]\d{4})$/,
};
/** Whether `platform` is a system we build, `arch` one of its chips, and `os` a version of it we build for. */
export function supported(platform: unknown, arch: unknown, os: unknown): boolean {
  return (
    SYSTEMS.includes(platform as System) &&
    ARCHES.includes(arch as (typeof ARCHES)[number]) &&
    typeof os === "string" &&
    SYSTEM_VERSION[platform as System].test(os)
  );
}
/** The Mac's builds a manifest may name: universal for every Mac, or Apple silicon's alone (a track's). */
type Slice = "universal" | "aarch64";
const SLICE_PLATFORMS: Record<Slice, readonly string[]> = {
  universal: ["darwin-aarch64", "darwin-x86_64"],
  aarch64: ["darwin-aarch64"],
};
/**
 * Windows' builds a manifest may name beside the Mac's: both chips' installers,
 * each named for its chip as Windows' tools name it, or none.
 */
const WINDOWS: Record<string, string> = { "windows-x86_64": "x64", "windows-aarch64": "arm64" };
const isWindows = (platform: string) => Object.hasOwn(WINDOWS, platform);
const MAX_MANIFEST = 128 * 1024;
const MAX_TRACK_LIST = 256 * 1024;
const MAX_ADMISSION = 64 * 1024;
/** The most versions, or halts, one admission list holds. */
const MAX_LISTED = 1000;
const MAX_DOWNLOAD = 512 * 1024 * 1024;
/** A moment, ISO 8601 with its zone: a halt's `at`, as the release machine writes it. */
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface Env {
  DB: D1Database;
  UPDATE_LIMIT: RateLimit;
  DOWNLOAD_LIMIT: RateLimit;
  UPDATES_ENABLED: string;
  DOWNLOADS_ENABLED: string;
  /** The deployed admission list: stable versions this deploy admits, beside the list in R2. */
  RELEASED_VERSIONS_JSON: string;
  /**
   * The Worker's objects: `admission.json`, and the tracks' `<track>/latest.json`,
   * `<track>/versions.json` and `<track>/<version>/<file>`, all under the prefix.
   */
  TRACKS: Pick<R2Bucket, "get">;
  /** The SHA-256 of alpha's key, as hex: a Worker secret. Unset, alpha answers no one. */
  ALPHA_KEY_SHA256?: string;
}
export interface Dependencies {
  fetch: (request: Request) => Promise<Response>;
  cache: Pick<Cache, "match" | "put">;
  now: () => Date;
  updatesOrigin: string;
  /**
   * GitHub's releases of the repository stable comes from: [`GITHUB`]. Only the
   * local stand-in's entry names another, on loopback (test/standin-entry.ts).
   */
  github?: string;
  /** Where the Worker's R2 keys start: none in production, `stand-in/` for the stand-in. */
  prefix?: string;
  /** Where the Worker's one line goes (docs/engineering/services-and-feedback.md#SERV-275). */
  log?: (line: string) => void;
}
/**
 * Where the lists are read: R2, through a minute's edge cache that every route
 * shares, keyed under the updates host whichever host asked.
 */
export interface Source {
  bucket: Env["TRACKS"];
  cache: Pick<Cache, "match" | "put">;
  origin: string;
  prefix: string;
  log: (line: string) => void;
}
interface Platform {
  signature: string;
  url: string;
}
interface Manifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, Platform>;
}
/** A version the update service no longer offers, and why. Nothing is deleted. */
export interface Halt {
  version: string;
  track: Channel;
  at: string;
  why: string;
}
/** The admission list, as the release writes it to R2 (docs/engineering/services-and-feedback.md#SERV-268). */
export interface Admission {
  /** Stable versions admitted beside the deployed list. */
  stable: readonly string[];
  halted: readonly Halt[];
}
const NOTHING: Admission = { stable: [], halted: [] };

export function response(
  status: number,
  body: string | null = null,
  headers: HeadersInit = {},
): Response {
  const h = new Headers(headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Cache-Control", "no-store");
  return new Response(body, { status, headers: h });
}
export function json(status: number, value: unknown): Response {
  return response(status, JSON.stringify(value), { "Content-Type": "application/json" });
}
/** The track a version names, or null for a release or anything else. */
export function trackOf(version: string): Track | null {
  return (TRACK_VERSION.exec(version)?.[4] as Track | undefined) ?? null;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Exactly these fields, every one of them. */
function exactly(value: Record<string, unknown>, fields: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((f) => Object.hasOwn(value, f));
}
/** Release order, for `X.Y.Z`. */
function compare(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
function archiveName(version: string, slice: Slice = "universal"): string {
  return `Proscenium_${version}_${slice}.app.tar.gz`;
}
/**
 * A file's path under a release's or a track's route. `download` is what the
 * website's Download sends a person to, and what manifests name; `update` is
 * what this service offers an installed copy, so the two are counted apart
 * (docs/engineering/services-and-feedback.md#SERV-286).
 */
function assetPath(version: string, file: string, via: Via = "download"): string {
  return `/${via}/v${version}/${file}`;
}
/**
 * How a file was asked for: on the download route, which the website's
 * Download and the Homebrew cask name, or on the update route, which this
 * service offers an installed copy.
 */
type Via = "download" | "update";
/** What a request for a release's file can count as (docs/engineering/services-and-feedback.md#SERV-286). */
export type FileKind = "website" | "homebrew" | "update" | "signature" | "own";
/**
 * What a request for a release's file counts as
 * (docs/engineering/services-and-feedback.md#SERV-286):
 *
 * - `own`: one of the project's own machines (the release's checks and
 *   proofs), which say `proscenium-checks` in their User-Agent;
 * - `signature`: a signature file, which an update fetches beside its
 *   archive, and which is neither a download nor an update;
 * - `update`: an installed copy, on the update route it was offered. The app
 *   sends no User-Agent, so the route is how it is told;
 * - `homebrew`: a download by Homebrew, which names itself (`Homebrew/…`);
 * - `website`: every other download, from the links the website gives.
 */
export function countedAs(via: Via, file: string, userAgent: string): FileKind {
  if (/\bproscenium-checks\b/i.test(userAgent)) return "own";
  if (file.endsWith(".sig")) return "signature";
  if (via === "update") return "update";
  if (/^Homebrew\//i.test(userAgent)) return "homebrew";
  return "website";
}
/** The system and chip a release's file is for, as the counts name them. */
export function fileTarget(version: string, file: string): { platform: string; arch: string } {
  const windows = installerPlatform(version, file);
  if (windows !== null) return { platform: "windows", arch: windows.slice("windows-".length) };
  const slice = /_(universal|aarch64|x86_64)\.(?:dmg|app\.tar\.gz)(?:\.sig)?$/.exec(file)?.[1];
  return { platform: "darwin", arch: slice ?? "" };
}
function sliceFiles(version: string, slice: Slice): string[] {
  return [
    archiveName(version, slice),
    `${archiveName(version, slice)}.sig`,
    `Proscenium_${version}_${slice}.dmg`,
  ];
}
/** Windows' installer for a chip, as Windows' tools name the chip: `x64`, `arm64`. */
function installerName(version: string, chip: string): string {
  return `Proscenium_${version}_${chip}-setup.exe`;
}
/** The Windows platform whose installer, or its signature, `file` is; null for any other file. */
function installerPlatform(version: string, file: string): string | null {
  for (const [platform, chip] of Object.entries(WINDOWS)) {
    const installer = installerName(version, chip);
    if (file === installer || file === `${installer}.sig`) return platform;
  }
  return null;
}
/** The archive a manifest's entry for `platform` must name: the Mac's slice's, or Windows' chip's installer. */
function archiveOf(platform: string, version: string, slice: Slice): string {
  return isWindows(platform)
    ? installerName(version, WINDOWS[platform])
    : archiveName(version, slice);
}
/**
 * A release's own files: the universal build's three, and Windows' installers
 * and their signatures, which are served only when its manifest names them.
 */
export function ownFile(version: string, file: string): boolean {
  return (
    sliceFiles(version, "universal").includes(file) || installerPlatform(version, file) !== null
  );
}
/**
 * A track version's own files: its Mac build's three, universal as the first
 * ones were or Apple silicon's, and Windows' installers and their signatures.
 */
export function ownTrackFile(version: string, file: string): boolean {
  return ownFile(version, file) || sliceFiles(version, "aarch64").includes(file);
}

/**
 * A manifest as the routes read it (docs/engineering/services-and-feedback.md#SERV-283):
 * what every system shares, the entries of each system whose part is valid,
 * and the systems whose part is not. Each system is judged on its own part
 * alone, so a broken Windows part never changes a Mac's answer.
 */
export interface Read {
  manifest: Manifest;
  /** Systems whose part does not validate: the Mac's when it has none, since every release carries the Mac. */
  broken: System[];
  /** Keys of no system we build: in no system's part, so never answered. */
  stray: string[];
}
/**
 * A release's manifest from GitHub, read per system. Validate upstream data
 * too: a manifest cannot turn this Worker into an open proxy. `github` is
 * where its archives must be: [`GITHUB`], or a stand-in's.
 */
export function readManifest(value: unknown, github: string = GITHUB): Read {
  return readManifestFor(
    value,
    (version) => VERSION.test(version),
    (url, version, file) => url === `${github}${assetPath(version, file)}`,
    ["universal"],
  );
}
/**
 * A track's manifest, read per system: one of its own versions, each archive
 * on the track's update route of one of `origins`: the update service's
 * own, as the pipeline writes it, or a stand-in's. A manifest written before
 * updates were counted apart names the download route, and is read the same
 * (docs/engineering/services-and-feedback.md#SERV-286).
 */
export function readTrackManifest(
  value: unknown,
  track: Track,
  origins: readonly string[] = [UPDATES],
): Read {
  return readManifestFor(
    value,
    (version) => trackOf(version) === track,
    (url, version, file) =>
      origins.some((o) =>
        (["update", "download"] as const).some(
          (via) => url === `${o}/v1/${track}${assetPath(version, file, via)}`,
        ),
      ),
    ["universal", "aarch64"],
  );
}
/** A manifest as a release must write it: every part valid, and no key of a system we do not build. */
function whole(read: Read): Manifest {
  if (read.broken.length || read.stray.length) throw new Error("Invalid platforms");
  return read.manifest;
}
/** A release's manifest, whole: what a stand-in serves, and what the pipeline must write. */
export function parseManifest(value: unknown, github: string = GITHUB): Manifest {
  return whole(readManifest(value, github));
}
/** A track's manifest, whole. */
export function parseTrackManifest(
  value: unknown,
  track: Track,
  origins: readonly string[] = [UPDATES],
): Manifest {
  return whole(readTrackManifest(value, track, origins));
}
/**
 * A manifest's entries for `keys`, each naming its own archive where
 * `archiveOk` says; null when any of them does not.
 */
function entries(
  platforms: Record<string, unknown>,
  keys: readonly string[],
  version: string,
  archive: (key: string) => string,
  archiveOk: (url: string, version: string, file: string) => boolean,
): Record<string, Platform> | null {
  const out: Record<string, Platform> = {};
  for (const key of keys) {
    const p = platforms[key];
    if (
      !record(p) ||
      Object.keys(p).some((k) => k !== "signature" && k !== "url") ||
      typeof p.signature !== "string" ||
      !/^[A-Za-z0-9+/=]{40,2048}$/.test(p.signature) ||
      typeof p.url !== "string" ||
      !archiveOk(p.url, version, archive(key))
    )
      return null;
    out[key] = { signature: p.signature, url: p.url };
  }
  return out;
}
/**
 * A manifest, read per system (docs/engineering/services-and-feedback.md#SERV-283).
 * What every system shares, its version, notes and date, is refused whole, as
 * before Windows. The Mac's part is exactly one slice's platforms (`slices`),
 * and every release carries it. Windows' part is both chips' installers or
 * none. A part that does not validate is that system's alone to be refused.
 */
function readManifestFor(
  value: unknown,
  versionOk: (version: string) => boolean,
  archiveOk: (url: string, version: string, file: string) => boolean,
  slices: Slice[],
): Read {
  if (
    !record(value) ||
    typeof value.version !== "string" ||
    !versionOk(value.version) ||
    !record(value.platforms)
  )
    throw new Error("Invalid manifest");
  if (Object.keys(value).some((k) => !["version", "notes", "pub_date", "platforms"].includes(k)))
    throw new Error("Unknown manifest field");
  const version = value.version;
  const platforms: Record<string, Platform> = {};
  const broken: System[] = [];
  const keys = Object.keys(value.platforms);
  // The Mac's: every Mac's platforms for a universal build, Apple silicon's
  // alone for its own, and nothing else named for a Mac.
  const mac = keys.filter((k) => k.startsWith("darwin-")).sort();
  const slice = slices.find((s) => [...SLICE_PLATFORMS[s]].sort().join(",") === mac.join(","));
  const macs =
    slice &&
    entries(
      value.platforms,
      SLICE_PLATFORMS[slice],
      version,
      (key) => archiveOf(key, version, slice),
      archiveOk,
    );
  if (macs) Object.assign(platforms, macs);
  else broken.push("darwin");
  // Windows': both chips, since every Windows release is built for both, or none.
  const windows = keys.filter((k) => k.startsWith("windows-"));
  if (windows.length) {
    const both = Object.keys(WINDOWS);
    const ours =
      windows.length === both.length &&
      windows.every(isWindows) &&
      entries(
        value.platforms,
        both,
        version,
        (key) => archiveOf(key, version, "universal"),
        archiveOk,
      );
    if (ours) Object.assign(platforms, ours);
    else broken.push("windows");
  }
  const stray = keys.filter((k) => !k.startsWith("darwin-") && !k.startsWith("windows-"));
  if (value.notes !== undefined && (typeof value.notes !== "string" || value.notes.length > 60_000))
    throw new Error("Invalid notes");
  if (
    value.pub_date !== undefined &&
    (typeof value.pub_date !== "string" ||
      !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.pub_date) ||
      !Number.isFinite(Date.parse(value.pub_date)))
  )
    throw new Error("Invalid date");
  return {
    manifest: {
      version,
      platforms,
      ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
      ...(typeof value.pub_date === "string" ? { pub_date: value.pub_date } : {}),
    },
    broken,
    stray,
  };
}

/**
 * The admission list, field by field: `{ v: 1, stable, halted }`, each halt
 * `{ version, track, at, why }` with a version of the track it names. Anything
 * else is not a list the release wrote.
 */
export function parseAdmission(value: unknown): Admission {
  if (!record(value) || !exactly(value, ["v", "stable", "halted"]))
    throw new Error("Invalid admission list");
  if (value.v !== 1) throw new Error("Unknown admission list version");
  const { stable, halted } = value;
  if (
    !Array.isArray(stable) ||
    stable.length > MAX_LISTED ||
    !stable.every((v) => typeof v === "string" && VERSION.test(v))
  )
    throw new Error("Invalid stable list");
  if (!Array.isArray(halted) || halted.length > MAX_LISTED) throw new Error("Invalid halts");
  return {
    stable: [...stable],
    halted: halted.map((h: unknown): Halt => {
      if (!record(h) || !exactly(h, ["version", "track", "at", "why"]))
        throw new Error("Invalid halt");
      const { version, track, at, why } = h;
      if (track !== "stable" && track !== "alpha" && track !== "beta")
        throw new Error("Invalid halt track");
      if (
        typeof version !== "string" ||
        !(track === "stable" ? VERSION.test(version) : trackOf(version) === track)
      )
        throw new Error("Invalid halted version");
      if (typeof at !== "string" || !TIME.test(at) || Number.isNaN(Date.parse(at)))
        throw new Error("Invalid halt time");
      if (typeof why !== "string" || why.length > 500) throw new Error("Invalid halt reason");
      return { version, track, at, why };
    }),
  };
}

function upstreamAllowed(url: URL, github: string): boolean {
  if (url.username || url.password) return false;
  const releases = new URL(github);
  // GitHub's releases of the one repository (or the stand-in's, on its own origin).
  if (url.origin === releases.origin && url.pathname.startsWith(`${releases.pathname}/`))
    return true;
  // And the hosts GitHub redirects a release's files to.
  return (
    url.protocol === "https:" &&
    !url.port &&
    ["objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(url.hostname)
  );
}
/**
 * What every upstream request carries: the service's own name, and nothing of
 * the visitor's. GitHub refuses a request from Cloudflare's network that names
 * no User-Agent, so without one every stable check and download failed in
 * production while passing everywhere else.
 */
export const UPSTREAM_HEADERS = { "User-Agent": "proscenium-updates" } as const;
/**
 * A release's source failed: GitHub, or a track's objects in R2, could not be
 * reached, refused, or answered something unusable. Only this answers 502, the
 * documented "GitHub unavailable" that sends the updater to its fallback
 * (docs/engineering/services-and-feedback.md#SERV-22). Any other throw is this
 * Worker's own fault and answers 500: a monitor that compares the
 * route with GitHub directly can then tell the two apart without reading a body
 * (docs/engineering/services-and-feedback.md#SERV-266).
 */
class Unavailable extends Error {}
/** A source's content that fails to read or parse is the source's failure. */
function sourced<T>(read: () => T): T {
  try {
    return read();
  } catch (cause) {
    throw cause instanceof Unavailable ? cause : new Unavailable("Invalid source", { cause });
  }
}
async function sourcedAsync<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    throw cause instanceof Unavailable ? cause : new Unavailable("Invalid source", { cause });
  }
}
/**
 * Call a source. Making the call is this Worker's part: workerd refuses fetch
 * called as another object's method with a synchronous "Illegal invocation",
 * and a missing binding throws the same way, so a throw here stays ours (500).
 * The call's promise rejecting (a lost connection, the timeout) is the source's.
 */
async function reach<T>(call: () => Promise<T>): Promise<T> {
  const pending = call();
  try {
    return await pending;
  } catch (cause) {
    throw new Unavailable("Unreachable", { cause });
  }
}
/** Fresh application headers on every hop. Cloudflare may add platform headers to fetch; this never supplies visitor metadata. */
async function upstream(address: string, deps: Dependencies): Promise<Response> {
  const github = deps.github ?? GITHUB;
  let url = new URL(address);
  for (let hop = 0; hop < 5; hop++) {
    if (!upstreamAllowed(url, github)) throw new Unavailable("Invalid upstream");
    const request = new Request(url, {
      redirect: "manual",
      headers: UPSTREAM_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    const result = await reach(() => deps.fetch(request));
    if (![301, 302, 303, 307, 308].includes(result.status)) return result;
    const location = result.headers.get("Location");
    await result.body?.cancel();
    if (!location) throw new Unavailable("Invalid redirect");
    url = sourced(() => new URL(location, url));
  }
  throw new Unavailable("Too many redirects");
}
export async function boundedBytes(body: Response, limit: number): Promise<Uint8Array> {
  const length = body.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await body.body?.cancel();
    throw new Error("Body too large");
  }
  const reader = body.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error("Body too large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
const utf8 = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
/**
 * A release's manifest from GitHub, read per system. It is kept for five
 * minutes as GitHub served it, every part as it was, so a broken part reads
 * as broken from the cache too, and a copy kept before a deploy reads the same.
 */
async function manifest(deps: Dependencies, version?: string): Promise<Read> {
  const github = deps.github ?? GITHUB;
  const address = `${github}/${version ? `download/v${version}` : "latest/download"}/latest.json`;
  const key = new Request(address);
  const cached = await deps.cache.match(key);
  if (cached) return readManifest(await cached.json(), github);
  const result = await upstream(address, deps);
  if (result.status !== 200) {
    await result.body?.cancel();
    throw new Unavailable("Upstream unavailable");
  }
  const bytes = await sourcedAsync(() => boundedBytes(result, MAX_MANIFEST));
  const value: unknown = sourced(() => JSON.parse(utf8(bytes)));
  const read = sourced(() => readManifest(value, github));
  if (version && read.manifest.version !== version) throw new Unavailable("Version mismatch");
  await deps.cache.put(
    key,
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    }),
  );
  return read;
}
/**
 * The manifest as `system` may be answered from it: its part must be valid, or
 * the release's source failed for that system's copies (502), and for no other.
 */
function judged(read: Read, system: System): Manifest {
  if (read.broken.includes(system)) throw new Unavailable(`Invalid ${system} platforms`);
  return read.manifest;
}

/** The lists' source for the update routes: the request's R2 binding, its cache and its origin. */
function sourceOf(env: Pick<Env, "TRACKS">, deps: Dependencies): Source {
  return {
    bucket: env.TRACKS,
    cache: deps.cache,
    origin: deps.updatesOrigin,
    prefix: deps.prefix ?? "",
    log: deps.log ?? (() => {}),
  };
}
/**
 * The header on a cached copy of an object R2 does not hold. workerd's cache
 * keeps no 204, so "nothing written" is kept as a 200 that says so, and is read
 * once a minute like anything else.
 */
const ABSENT = "Proscenium-Absent";
/** An object's text, read from R2 once a minute at most; null when nothing is written there. */
async function trackText(source: Source, key: string, limit: number): Promise<string | null> {
  const full = `${source.prefix}${key}`;
  const cacheKey = new Request(`${source.origin}/tracks/${full}`);
  const cached = await source.cache.match(cacheKey);
  if (cached) return cached.headers.has(ABSENT) ? null : cached.text();
  const object = await reach(() => source.bucket.get(full));
  let text: string | null = null;
  if (object) {
    const bytes = await sourcedAsync(() =>
      boundedBytes(
        new Response(object.body, { headers: { "Content-Length": String(object.size) } }),
        limit,
      ),
    );
    text = sourced(() => utf8(bytes));
  }
  await source.cache.put(
    cacheKey,
    new Response(text ?? "", {
      headers: {
        "Cache-Control": "public, max-age=60",
        ...(text === null ? { [ABSENT]: "1" } : {}),
      },
    }),
  );
  return text;
}
/** Every version the track has published, oldest first. Nothing published yet is an empty list. */
async function trackVersions(source: Source, track: Track): Promise<string[]> {
  const text = await trackText(source, `${track}/versions.json`, MAX_TRACK_LIST);
  if (text === null) return [];
  const list: unknown = sourced(() => JSON.parse(text));
  if (!Array.isArray(list) || !list.every((v) => typeof v === "string" && trackOf(v) === track))
    throw new Unavailable("Invalid track list");
  return list;
}

/** An admission list's bytes as the list, or null when they are not one. */
function readAdmission(bytes: Uint8Array | null): Admission | null {
  if (bytes === null) return null;
  try {
    return parseAdmission(JSON.parse(utf8(bytes)));
  } catch {
    return null;
  }
}
/**
 * The admission list, read at most once a minute
 * (docs/engineering/services-and-feedback.md#SERV-268). None written is an
 * empty list. One that cannot be read, or is not the list's shape, is said in
 * the Worker's one line (docs/engineering/services-and-feedback.md#SERV-275)
 * and taken as empty: it never admits, and never halts, anything. Content that
 * is not the list's shape is kept as empty for the minute, and said once; R2
 * failing to answer is asked again by the next request.
 */
export async function admission(source: Source): Promise<Admission> {
  const key = `${source.prefix}${ADMISSION}`;
  const cacheKey = new Request(`${source.origin}/tracks/${key}`);
  const cached = await source.cache.match(cacheKey);
  if (cached) {
    try {
      return parseAdmission(await cached.json());
    } catch {
      return NOTHING;
    }
  }
  let written = false;
  let bytes: Uint8Array | null = null;
  try {
    const object = await reach(() => source.bucket.get(key));
    written = object !== null;
    // Larger than a list can be: its content's fault, not R2's, so not read at all.
    if (object && object.size > MAX_ADMISSION) await object.body.cancel();
    else if (object)
      bytes = await reach(() =>
        boundedBytes(
          new Response(object.body, { headers: { "Content-Length": String(object.size) } }),
          MAX_ADMISSION,
        ),
      );
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    source.log(`${key} could not be read: nothing is admitted or halted by it until it can be`);
    return NOTHING;
  }
  const found = written ? readAdmission(bytes) : NOTHING;
  if (found === null)
    source.log(`${key} is not an admission list: nothing is admitted or halted by it`);
  // Kept for the minute as the list it was taken as: an empty one when none was written or it was not one.
  await source.cache.put(
    cacheKey,
    new Response(JSON.stringify({ v: 1, ...(found ?? NOTHING) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    }),
  );
  return found ?? NOTHING;
}
/** The deployed admission list: the stable versions this deploy admits. */
function deployed(env: Pick<Env, "RELEASED_VERSIONS_JSON">): string[] {
  const versions: unknown = JSON.parse(env.RELEASED_VERSIONS_JSON);
  return Array.isArray(versions)
    ? versions.filter((v): v is string => typeof v === "string" && VERSION.test(v))
    : [];
}
/** Stable's releases: the deployed list and the admission list's, and the list itself for its halts. */
async function stableReleases(
  env: Pick<Env, "RELEASED_VERSIONS_JSON">,
  source: Source,
): Promise<{ admitted: Set<string>; listed: Admission }> {
  const listed = await admission(source);
  return { admitted: new Set([...deployed(env), ...listed.stable]), listed };
}
/**
 * Whether a version is released, and where: the one answer every route asks
 * (docs/engineering/services-and-feedback.md#SERV-269). A release `X.Y.Z` is
 * stable's when the deployed list or the admission list holds it; a track
 * build's whole version is released when its own track's list of published
 * versions holds it. `among` is what counts for the asker: an update check any
 * of the three, a report stable and beta, a link stable and beta.
 *
 * A halt does not change this answer, only what is offered
 * (docs/engineering/services-and-feedback.md#SERV-270): a copy running a
 * halted version is still answered, counted and heard.
 */
export async function releasedOn(
  env: Pick<Env, "RELEASED_VERSIONS_JSON">,
  source: Source,
  version: string,
  among: readonly Channel[],
): Promise<Channel | null> {
  if (VERSION.test(version)) {
    if (!among.includes("stable")) return null;
    if (deployed(env).includes(version)) return "stable";
    return (await admission(source)).stable.includes(version) ? "stable" : null;
  }
  const track = trackOf(version);
  if (track === null || !among.includes(track)) return null;
  return (await trackVersions(source, track)).includes(version) ? track : null;
}
function halted(listed: Admission, channel: Channel, version: string): boolean {
  return listed.halted.some((h) => h.track === channel && h.version === version);
}
/**
 * A halt is in force on stable when the newest release the service knows of,
 * admitted or halted, is halted: GitHub's newest release is then most likely
 * the one halted, and its manifest is where the updater goes next.
 */
function haltInForce(admitted: Set<string>, listed: Admission): boolean {
  const stopped = listed.halted.filter((h) => h.track === "stable").map((h) => h.version);
  const newest = [...admitted, ...stopped].sort(compare).at(-1);
  return newest !== undefined && stopped.includes(newest);
}
/**
 * Whether the request holds alpha's key: the SHA-256 of its header is the
 * secret's. The key is compared as a digest, in time that does not depend on
 * where it differs, and never reaches a log, a D1 row or a response.
 */
async function holdsAlphaKey(
  request: Request,
  env: Pick<Env, "ALPHA_KEY_SHA256">,
): Promise<boolean> {
  const expected = env.ALPHA_KEY_SHA256 ?? "";
  const key = request.headers.get(TRACK_KEY_HEADER);
  if (!/^[0-9a-f]{64}$/.test(expected) || key === null || !TRACK_KEY.test(key)) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  let difference = 0;
  for (let i = 0; i < digest.length; i++)
    difference |= digest[i] ^ parseInt(expected.slice(2 * i, 2 * i + 2), 16);
  return difference === 0;
}
/**
 * Whether a check from `version` is answered, and whether it is counted. A
 * version released anywhere is both: a copy may ask from any track
 * (docs/engineering/services-and-feedback.md#SERV-250). An alpha version on no
 * list, asked without the key, is answered as if it were listed but not
 * counted: a refusal there would tell anyone which alphas exist.
 */
async function admitted(
  env: Env,
  source: Source,
  version: string,
  keyed: boolean,
): Promise<{ answer: boolean; counted: boolean }> {
  const listed = (await releasedOn(env, source, version, ["stable", "alpha", "beta"])) !== null;
  return { answer: listed || (!keyed && trackOf(version) === "alpha"), counted: listed };
}

async function count(
  env: Env,
  deps: Dependencies,
  event: string,
  platform: string,
  arch: string,
  version: string,
  os: string,
) {
  await env.DB.prepare(`INSERT INTO update_counts (day, kind, platform, arch, version, os, count)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(day, kind, platform, arch, version, os) DO UPDATE SET count = count + 1`)
    .bind(deps.now().toISOString().slice(0, 10), event, platform, arch, version, os)
    .run();
}
/**
 * One request for a release's file, counted by what it was and what it is for
 * (docs/engineering/services-and-feedback.md#SERV-286): the day, what it
 * counts as (`countedAs`), the system and chip, and the version. Nothing of the
 * person who asked.
 */
async function countFile(
  env: Env,
  deps: Dependencies,
  request: Request,
  via: Via,
  version: string,
  file: string,
) {
  const { platform, arch } = fileTarget(version, file);
  await count(
    env,
    deps,
    countedAs(via, file, request.headers.get("User-Agent") ?? ""),
    platform,
    arch,
    version,
    "",
  );
}
async function rate(request: Request, binding: RateLimit): Promise<boolean> {
  // A short-lived rate-limit bucket only; this key is never written to D1 or logged.
  return (await binding.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" })).success;
}

/** The copy a check comes from: its system and chip, as its address names them. */
interface Asker {
  system: System;
  arch: string;
}
/**
 * A manifest as this service offers it to `asker`
 * (docs/engineering/services-and-feedback.md#SERV-283): its own system's
 * entries alone, each archive on `route` here by its own file's name, the
 * download route of a release (`/v1`) or of a track (`/v1/<track>`, whichever
 * of the service's hosts the manifest named,
 * docs/engineering/services-and-feedback.md#SERV-278); and nothing newer (204)
 * when the manifest names no build for the copy's own system and chip. So a
 * Mac's answer is the same whether the manifest names Windows or not, and in
 * production a track's answer is its manifest's entries as the pipeline wrote
 * them.
 */
function offer(data: Manifest, asker: Asker, route: string): Response {
  if (!Object.hasOwn(data.platforms, `${asker.system}-${asker.arch}`)) return response(204);
  const platforms: Record<string, Platform> = {};
  for (const [key, p] of Object.entries(data.platforms))
    if (key.startsWith(`${asker.system}-`))
      platforms[key] = {
        signature: p.signature,
        url: `${route}${assetPath(data.version, p.url.slice(p.url.lastIndexOf("/") + 1), "update")}`,
      };
  return json(200, { ...data, platforms });
}
/**
 * GitHub's newest release is halted: offer the newest admitted release before
 * it that is not, as if the halted one were not there, or say there is nothing
 * newer. Never an error, which would send the updater on to GitHub's manifest,
 * and GitHub's manifest names the halted release.
 */
async function offerBefore(
  deps: Dependencies,
  asker: Asker,
  admitted: Set<string>,
  listed: Admission,
  stopped: string,
): Promise<Response> {
  const before = [...admitted]
    .filter((v) => compare(v, stopped) < 0 && !halted(listed, "stable", v))
    .sort(compare)
    .at(-1);
  if (before === undefined) return response(204);
  try {
    const data = judged(await manifest(deps, before), asker.system);
    return offer(data, asker, `${deps.updatesOrigin}/v1`);
  } catch {
    return response(204);
  }
}
/**
 * Stable's answer to a check: the newest release, with the asker's own
 * archives on this service's own route. A halted newest release is not offered
 * (docs/engineering/services-and-feedback.md#SERV-270), and while a halt is in
 * force no failure here answers what would send the updater on to GitHub
 * (docs/engineering/services-and-feedback.md#SERV-271).
 */
async function stableAnswer(
  env: Env,
  deps: Dependencies,
  source: Source,
  asker: Asker,
): Promise<Response> {
  const { admitted, listed } = await stableReleases(env, source);
  try {
    // Judged on the asker's own system's part alone: another's broken part changes nothing here.
    const data = judged(await manifest(deps), asker.system);
    if (halted(listed, "stable", data.version))
      return await offerBefore(deps, asker, admitted, listed, data.version);
    // Published and not yet admitted: the updater's fallback serves it from GitHub itself.
    if (!admitted.has(data.version)) return response(502);
    return offer(data, asker, `${deps.updatesOrigin}/v1`);
  } catch (error) {
    if (haltInForce(admitted, listed)) return response(204);
    throw error;
  }
}

/** Only documented GET routes answer. No echo of a request or exception in any response. */
export async function updates(request: Request, env: Env, deps: Dependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== deps.updatesOrigin || request.method !== "GET" || url.search)
    return response(404);
  // Before anything else answers, so no switch, limit or refusal says the track is there.
  const keyed = await holdsAlphaKey(request, env);
  if (url.pathname.startsWith("/v1/alpha/") && !keyed) return response(404);
  // `/v1/stable/…` is a second name for the unsegmented routes copies built before tracks ask.
  const check = /^\/v1\/(?:stable\/)?(darwin|windows)\/(aarch64|x86_64)\/([^/]+)$/.exec(
    url.pathname,
  );
  const download = /^\/v1\/(?:stable\/)?(download|update)\/v([^/]+)\/([^/]+)$/.exec(url.pathname);
  const trackCheck = /^\/v1\/(alpha|beta)\/(darwin|windows)\/(aarch64|x86_64)\/([^/]+)$/.exec(
    url.pathname,
  );
  const trackDownload = /^\/v1\/(alpha|beta)\/(download|update)\/v([^/]+)\/([^/]+)$/.exec(
    url.pathname,
  );
  if (!check && !download && !trackCheck && !trackDownload) return response(404);
  const source = sourceOf(env, deps);
  try {
    if (trackCheck) {
      if (env.UPDATES_ENABLED !== "true") return response(503);
      if (!(await rate(request, env.UPDATE_LIMIT))) return response(429);
      const [, track, platform, arch, version] = trackCheck as unknown as [
        string,
        Track,
        System,
        string,
        string,
      ];
      const os = request.headers.get("Proscenium-OS") ?? "";
      if (!supported(platform, arch, os)) return response(400);
      const admit = await admitted(env, source, version, keyed);
      if (!admit.answer) return response(400);
      if (admit.counted) await count(env, deps, "check", platform, arch, version, os);
      const asker = { system: platform, arch };
      // An Intel Mac takes stable releases alone: a track's Mac builds are Apple
      // silicon's. The rule is the Mac's: x86_64 Windows is not an Intel Mac.
      if (platform === "darwin" && arch === "x86_64")
        return await stableAnswer(env, deps, source, asker);
      const text = await trackText(source, `${track}/latest.json`, MAX_MANIFEST);
      // Nothing published on the track yet: up to date.
      if (text === null) return response(204);
      // As the pipeline writes it, on the service's own host, or already on this Worker's.
      const data = judged(
        sourced(() => readTrackManifest(JSON.parse(text), track, [UPDATES, deps.updatesOrigin])),
        platform,
      );
      // Halted: not offered. The track keeps no manifest of the versions before
      // its newest, so a copy hears there is nothing newer until the next one.
      if (halted(await admission(source), track, data.version)) return response(204);
      if (!(await trackVersions(source, track)).includes(data.version)) return response(502);
      return offer(data, asker, `${deps.updatesOrigin}/v1/${track}`);
    }
    if (trackDownload) {
      if (env.DOWNLOADS_ENABLED !== "true") return response(503);
      if (!(await rate(request, env.DOWNLOAD_LIMIT))) return response(429);
      const [, track, via, version, file] = trackDownload as unknown as [
        string,
        Track,
        Via,
        string,
        string,
      ];
      if (
        trackOf(version) !== track ||
        !ownTrackFile(version, file) ||
        !(await trackVersions(source, track)).includes(version) ||
        halted(await admission(source), track, version)
      )
        return response(404);
      const object = await reach(() =>
        source.bucket.get(`${source.prefix}${track}/${version}/${file}`),
      );
      if (!object) return response(404);
      if (object.size > MAX_DOWNLOAD) {
        await object.body.cancel();
        return response(502);
      }
      await countFile(env, deps, request, via, version, file);
      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Length": String(object.size),
        },
      });
    }
    if (check) {
      if (env.UPDATES_ENABLED !== "true") return response(503);
      if (!(await rate(request, env.UPDATE_LIMIT))) return response(429);
      const [, platform, arch, version] = check as unknown as [string, System, string, string];
      const os = request.headers.get("Proscenium-OS") ?? "";
      if (!supported(platform, arch, os)) return response(400);
      const admit = await admitted(env, source, version, keyed);
      if (!admit.answer) return response(400);
      if (admit.counted) await count(env, deps, "check", platform, arch, version, os);
      return await stableAnswer(env, deps, source, { system: platform, arch });
    }
    if (env.DOWNLOADS_ENABLED !== "true") return response(503);
    if (!(await rate(request, env.DOWNLOAD_LIMIT))) return response(429);
    const [, via, version, file] = download! as unknown as [string, Via, string, string];
    // Released on stable. A halted release's files are not served as an
    // update. On the download route they are, as GitHub serves them: the
    // website's Download and the cask name a release until they are moved,
    // and a halt deletes nothing (docs/engineering/services-and-feedback.md#SERV-286).
    if (
      !ownFile(version, file) ||
      (await releasedOn(env, source, version, ["stable"])) === null ||
      (via === "update" && halted(await admission(source), "stable", version))
    )
      return response(404);
    // Prove the release exists, and declares its canonical archive, before
    // serving any file: the archive of the file's own system, judged on that
    // system's part alone. Windows' installers only from a release whose
    // manifest names that chip's.
    const installer = installerPlatform(version, file);
    const data = judged(await manifest(deps, version), installer === null ? "darwin" : "windows");
    if (installer !== null && !Object.hasOwn(data.platforms, installer)) return response(404);
    const result = await upstream(`${deps.github ?? GITHUB}${assetPath(version, file)}`, deps);
    if (result.status !== 200 || !result.body) {
      await result.body?.cancel();
      return response(502);
    }
    const length = result.headers.get("Content-Length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_DOWNLOAD)) {
      await result.body.cancel();
      return response(502);
    }
    let received = 0;
    const stream = result.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > MAX_DOWNLOAD) {
            controller.error(new Error("Download too large"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    await countFile(env, deps, request, via, version, file);
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (length !== null) headers["Content-Length"] = length;
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    return response(error instanceof Unavailable ? 502 : 500);
  }
}
