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
 * app offered Intel stable only) is answered as stable answers it.
 */
export const REPOSITORY = "proscenium-app/proscenium";
export const GITHUB = `https://github.com/${REPOSITORY}/releases`;
export const UPDATES = "https://updates.proscenium.ink";
/** A release: `X.Y.Z`. */
export const VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
/** A track build's whole version, which names its track: `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`. */
export const TRACK_VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})-(alpha|beta)\.(0|[1-9]\d{0,8})$/;
export type Track = "alpha" | "beta";
/** The header an alpha copy's key travels in, beside `Proscenium-OS`, on alpha's requests and nothing else. */
export const TRACK_KEY_HEADER = "Proscenium-Track-Key";
/** A key as scripts/track-key.mjs makes it: 32 random bytes, base64url, unpadded. */
export const TRACK_KEY = /^[A-Za-z0-9_-]{43}$/;
const PLATFORMS = ["darwin-aarch64", "darwin-x86_64"] as const;
/** The builds a manifest may name: universal for every Mac, or Apple silicon's alone (a track's). */
type Slice = "universal" | "aarch64";
const SLICE_PLATFORMS: Record<Slice, readonly string[]> = { universal: PLATFORMS, aarch64: ["darwin-aarch64"] };
const MAX_MANIFEST = 128 * 1024;
const MAX_TRACK_LIST = 256 * 1024;
const MAX_DOWNLOAD = 512 * 1024 * 1024;

export interface Env {
  DB: D1Database;
  UPDATE_LIMIT: RateLimit;
  DOWNLOAD_LIMIT: RateLimit;
  UPDATES_ENABLED: string;
  DOWNLOADS_ENABLED: string;
  /** Admission list, updated when a release is cut, including local signed test releases. */
  RELEASED_VERSIONS_JSON: string;
  /** The tracks' objects: `<track>/latest.json`, `<track>/versions.json`, `<track>/<version>/<file>`. */
  TRACKS: Pick<R2Bucket, "get">;
  /** The SHA-256 of alpha's key, as hex: a Worker secret. Unset, alpha answers no one. */
  ALPHA_KEY_SHA256?: string;
}
export interface Dependencies {
  fetch: (request: Request) => Promise<Response>;
  cache: Pick<Cache, "match" | "put">;
  now: () => Date;
  updatesOrigin: string;
}
interface Platform { signature: string; url: string }
interface Manifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, Platform>;
}

export function response(status: number, body: string | null = null, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Cache-Control", "no-store");
  return new Response(body, { status, headers: h });
}
export function json(status: number, value: unknown): Response {
  return response(status, JSON.stringify(value), { "Content-Type": "application/json" });
}
export function released(env: Pick<Env, "RELEASED_VERSIONS_JSON">, version: string): boolean {
  const versions: unknown = JSON.parse(env.RELEASED_VERSIONS_JSON);
  return VERSION.test(version) && Array.isArray(versions) && versions.includes(version);
}
/** The track a version names, or null for a release or anything else. */
export function trackOf(version: string): Track | null {
  return (TRACK_VERSION.exec(version)?.[4] as Track | undefined) ?? null;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function archiveName(version: string, slice: Slice = "universal"): string { return `Proscenium_${version}_${slice}.app.tar.gz`; }
function assetPath(version: string, file: string): string { return `/download/v${version}/${file}`; }
function sliceFiles(version: string, slice: Slice): string[] {
  return [archiveName(version, slice), `${archiveName(version, slice)}.sig`, `Proscenium_${version}_${slice}.dmg`];
}
/** A release's own files: the universal build's three. */
export function ownFile(version: string, file: string): boolean {
  return sliceFiles(version, "universal").includes(file);
}
/** A track version's own files: its build's three, universal as the first ones were or Apple silicon's. */
export function ownTrackFile(version: string, file: string): boolean {
  return ownFile(version, file) || sliceFiles(version, "aarch64").includes(file);
}

/** Validate upstream data too: a manifest cannot turn this Worker into an open proxy. */
export function parseManifest(value: unknown): Manifest {
  return parseManifestFor(value, (version) => VERSION.test(version), (version) => `${GITHUB}${assetPath(version, archiveName(version))}`, ["universal"]);
}
/** A track's manifest: one of its own versions, each archive on its own download route. */
export function parseTrackManifest(value: unknown, track: Track): Manifest {
  return parseManifestFor(value, (version) => trackOf(version) === track,
    (version, slice) => `${UPDATES}/v1/${track}${assetPath(version, archiveName(version, slice))}`, ["universal", "aarch64"]);
}
function parseManifestFor(value: unknown, versionOk: (version: string) => boolean,
  archiveUrl: (version: string, slice: Slice) => string, slices: Slice[]): Manifest {
  if (!record(value) || typeof value.version !== "string" || !versionOk(value.version)
    || !record(value.platforms)) throw new Error("Invalid manifest");
  if (Object.keys(value).some(k => !["version", "notes", "pub_date", "platforms"].includes(k))) throw new Error("Unknown manifest field");
  const version = value.version;
  const platforms: Record<string, Platform> = {};
  // Exactly one slice's platforms: every Mac's for a universal build, Apple silicon's alone for its own.
  const keys = Object.keys(value.platforms).sort().join(",");
  const slice = slices.find((s) => [...SLICE_PLATFORMS[s]].sort().join(",") === keys);
  if (!slice) throw new Error("Invalid platforms");
  for (const key of SLICE_PLATFORMS[slice]) {
    const p = value.platforms[key];
    if (!record(p) || Object.keys(p).some(k => k !== "signature" && k !== "url")
      || typeof p.signature !== "string" || !/^[A-Za-z0-9+/=]{40,2048}$/.test(p.signature)
      || p.url !== archiveUrl(version, slice)) throw new Error("Invalid archive");
    platforms[key] = { signature: p.signature, url: p.url };
  }
  if (value.notes !== undefined && (typeof value.notes !== "string" || value.notes.length > 60_000)) throw new Error("Invalid notes");
  if (value.pub_date !== undefined && (typeof value.pub_date !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.pub_date) || !Number.isFinite(Date.parse(value.pub_date)))) throw new Error("Invalid date");
  return { version, platforms, ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
    ...(typeof value.pub_date === "string" ? { pub_date: value.pub_date } : {}) };
}

function upstreamAllowed(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port
    && ((url.hostname === "github.com" && url.pathname.startsWith(`/${REPOSITORY}/releases/`))
      || ["objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(url.hostname));
}
/**
 * What every upstream request carries: the service's own name, and nothing of
 * the visitor's. GitHub refuses a request from Cloudflare's network that names
 * no User-Agent, so without one every stable check and download failed in
 * production while passing everywhere else.
 */
export const UPSTREAM_HEADERS = { "User-Agent": "proscenium-updates" } as const;
/** Fresh application headers on every hop. Cloudflare may add platform headers to fetch; this never supplies visitor metadata. */
async function upstream(address: string, deps: Dependencies): Promise<Response> {
  let url = new URL(address);
  for (let hop = 0; hop < 5; hop++) {
    if (!upstreamAllowed(url)) throw new Error("Invalid upstream");
    const result = await deps.fetch(new Request(url, { redirect: "manual", headers: UPSTREAM_HEADERS, signal: AbortSignal.timeout(30_000) }));
    if (![301, 302, 303, 307, 308].includes(result.status)) return result;
    const location = result.headers.get("Location");
    await result.body?.cancel();
    if (!location) throw new Error("Invalid redirect");
    url = new URL(location, url);
  }
  throw new Error("Too many redirects");
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
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function manifest(deps: Dependencies, version?: string): Promise<Manifest> {
  const address = `${GITHUB}/${version ? `download/v${version}` : "latest/download"}/latest.json`;
  const key = new Request(address);
  const cached = await deps.cache.match(key);
  if (cached) return parseManifest(await cached.json());
  const result = await upstream(address, deps);
  if (result.status !== 200) { await result.body?.cancel(); throw new Error("Upstream unavailable"); }
  const data = parseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(await boundedBytes(result, MAX_MANIFEST))));
  if (version && data.version !== version) throw new Error("Version mismatch");
  await deps.cache.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } }));
  return data;
}
/** A track's object as text, read from R2 once a minute at most; null when the pipeline has written none. */
async function trackText(env: Env, deps: Dependencies, key: string, limit: number): Promise<string | null> {
  const cacheKey = new Request(`${deps.updatesOrigin}/tracks/${key}`);
  const cached = await deps.cache.match(cacheKey);
  if (cached) return cached.status === 204 ? null : cached.text();
  const object = await env.TRACKS.get(key);
  let text: string | null = null;
  if (object) {
    const bytes = await boundedBytes(new Response(object.body, { headers: { "Content-Length": String(object.size) } }), limit);
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  }
  await deps.cache.put(cacheKey, new Response(text, { status: text === null ? 204 : 200, headers: { "Cache-Control": "public, max-age=60" } }));
  return text;
}
/** Every version the track has published, oldest first. Nothing published yet is an empty list. */
async function trackVersions(env: Env, deps: Dependencies, track: Track): Promise<string[]> {
  const text = await trackText(env, deps, `${track}/versions.json`, MAX_TRACK_LIST);
  if (text === null) return [];
  const list: unknown = JSON.parse(text);
  if (!Array.isArray(list) || !list.every((v) => typeof v === "string" && trackOf(v) === track)) throw new Error("Invalid track list");
  return list;
}
/** A copy may ask from any track (docs/engineering/services-and-feedback.md#SERV-250): the release list, or the list of the track its version names. */
async function plausible(env: Env, deps: Dependencies, version: string): Promise<boolean> {
  if (released(env, version)) return true;
  const track = trackOf(version);
  return track !== null && (await trackVersions(env, deps, track)).includes(version);
}
const OS = /^(1[4-9]|[2-9]\d)\.(0|[1-9]\d?)$/;

/**
 * Whether the request holds alpha's key: the SHA-256 of its header is the
 * secret's. The key is compared as a digest, in time that does not depend on
 * where it differs, and never reaches a log, a D1 row or a response.
 */
async function holdsAlphaKey(request: Request, env: Pick<Env, "ALPHA_KEY_SHA256">): Promise<boolean> {
  const expected = env.ALPHA_KEY_SHA256 ?? "";
  const key = request.headers.get(TRACK_KEY_HEADER);
  if (!/^[0-9a-f]{64}$/.test(expected) || key === null || !TRACK_KEY.test(key)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  let difference = 0;
  for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ parseInt(expected.slice(2 * i, 2 * i + 2), 16);
  return difference === 0;
}
/**
 * Whether a check from `version` is answered, and whether it is counted. A
 * version on a list is both. An alpha version on no list, asked without the
 * key, is answered as if it were listed but not counted: a refusal there
 * would tell anyone which alphas exist.
 */
async function admitted(env: Env, deps: Dependencies, version: string, keyed: boolean): Promise<{ answer: boolean; counted: boolean }> {
  const listed = await plausible(env, deps, version);
  return { answer: listed || (!keyed && trackOf(version) === "alpha"), counted: listed };
}

async function count(env: Env, deps: Dependencies, event: string, platform: string, arch: string, version: string, os: string) {
  await env.DB.prepare(`INSERT INTO update_counts (day, kind, platform, arch, version, os, count)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(day, kind, platform, arch, version, os) DO UPDATE SET count = count + 1`)
    .bind(deps.now().toISOString().slice(0, 10), event, platform, arch, version, os).run();
}
async function rate(request: Request, binding: RateLimit): Promise<boolean> {
  // A short-lived rate-limit bucket only; this key is never written to D1 or logged.
  return (await binding.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" })).success;
}

/** Stable's answer to a check: the newest release, with its archive on this service's own route. */
async function stableAnswer(env: Env, deps: Dependencies): Promise<Response> {
  const data = await manifest(deps);
  if (!released(env, data.version)) return response(502);
  for (const p of Object.values(data.platforms)) {
    p.url = `${deps.updatesOrigin}/v1${assetPath(data.version, archiveName(data.version))}`;
  }
  return json(200, data);
}

/** Only documented GET routes answer. No echo of a request or exception in any response. */
export async function updates(request: Request, env: Env, deps: Dependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== deps.updatesOrigin || request.method !== "GET" || url.search) return response(404);
  // Before anything else answers, so no switch, limit or refusal says the track is there.
  const keyed = await holdsAlphaKey(request, env);
  if (url.pathname.startsWith("/v1/alpha/") && !keyed) return response(404);
  // `/v1/stable/…` is a second name for the unsegmented routes copies built before tracks ask.
  const check = /^\/v1\/(?:stable\/)?(darwin)\/(aarch64|x86_64)\/([^/]+)$/.exec(url.pathname);
  const download = /^\/v1\/(?:stable\/)?download\/v([^/]+)\/([^/]+)$/.exec(url.pathname);
  const trackCheck = /^\/v1\/(alpha|beta)\/(darwin)\/(aarch64|x86_64)\/([^/]+)$/.exec(url.pathname);
  const trackDownload = /^\/v1\/(alpha|beta)\/download\/v([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!check && !download && !trackCheck && !trackDownload) return response(404);
  try {
    if (trackCheck) {
      if (env.UPDATES_ENABLED !== "true") return response(503);
      if (!await rate(request, env.UPDATE_LIMIT)) return response(429);
      const [, track, platform, arch, version] = trackCheck as unknown as [string, Track, string, string, string];
      const os = request.headers.get("Proscenium-OS") ?? "";
      if (!OS.test(os)) return response(400);
      const admit = await admitted(env, deps, version, keyed);
      if (!admit.answer) return response(400);
      if (admit.counted) await count(env, deps, "check", platform, arch, version, os);
      // An Intel Mac takes stable releases alone: a track's builds are Apple silicon's.
      if (arch === "x86_64") return await stableAnswer(env, deps);
      const text = await trackText(env, deps, `${track}/latest.json`, MAX_MANIFEST);
      // Nothing published on the track yet: up to date.
      if (text === null) return response(204);
      const data = parseTrackManifest(JSON.parse(text), track);
      if (!(await trackVersions(env, deps, track)).includes(data.version)) return response(502);
      return json(200, data);
    }
    if (trackDownload) {
      if (env.DOWNLOADS_ENABLED !== "true") return response(503);
      if (!await rate(request, env.DOWNLOAD_LIMIT)) return response(429);
      const [, track, version, file] = trackDownload as unknown as [string, Track, string, string];
      if (trackOf(version) !== track || !ownTrackFile(version, file) || !(await trackVersions(env, deps, track)).includes(version)) return response(404);
      const object = await env.TRACKS.get(`${track}/${version}/${file}`);
      if (!object) return response(404);
      if (object.size > MAX_DOWNLOAD) { await object.body.cancel(); return response(502); }
      await count(env, deps, "download", "", "", version, "");
      return new Response(object.body, { status: 200, headers: {
        "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(object.size),
      } });
    }
    if (check) {
      if (env.UPDATES_ENABLED !== "true") return response(503);
      if (!await rate(request, env.UPDATE_LIMIT)) return response(429);
      const [, platform, arch, version] = check;
      const os = request.headers.get("Proscenium-OS") ?? "";
      if (!OS.test(os)) return response(400);
      const admit = await admitted(env, deps, version, keyed);
      if (!admit.answer) return response(400);
      if (admit.counted) await count(env, deps, "check", platform, arch, version, os);
      return await stableAnswer(env, deps);
    }
    if (env.DOWNLOADS_ENABLED !== "true") return response(503);
    if (!await rate(request, env.DOWNLOAD_LIMIT)) return response(429);
    const [, version, file] = download!;
    if (!released(env, version) || !ownFile(version, file)) return response(404);
    // Prove the release exists, and declares its canonical archive, before serving any file.
    await manifest(deps, version);
    const result = await upstream(`${GITHUB}${assetPath(version, file)}`, deps);
    if (result.status !== 200 || !result.body) { await result.body?.cancel(); return response(502); }
    const length = result.headers.get("Content-Length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_DOWNLOAD)) {
      await result.body.cancel(); return response(502);
    }
    let received = 0;
    const stream = result.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_DOWNLOAD) { controller.error(new Error("Download too large")); return; }
        controller.enqueue(chunk);
      },
    }));
    await count(env, deps, "download", "", "", version, "");
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (length !== null) headers["Content-Length"] = length;
    return new Response(stream, { status: 200, headers });
  } catch { return response(502); }
}
