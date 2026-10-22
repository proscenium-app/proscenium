// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import events from "../events.json";
import {
  boundedBytes,
  releasedOn,
  response,
  supported,
  TRACK_VERSION,
  VERSION,
  type Source,
  type System,
} from "./updates";
export const REPORTS = "https://reports.proscenium.ink";
export const MAX_EVENTS_BODY = 16 * 1024;
export interface ReportsEnv {
  DB: D1Database;
  EVENTS_LIMIT: RateLimit;
  EVENTS_ENABLED: string;
  RELEASED_VERSIONS_JSON: string;
}
/**
 * Where a report may come from: a release, or a published beta, whose reports
 * are counted apart by their whole version and their track
 * (docs/engineering/services-and-feedback.md#SERV-272). Alpha's are refused.
 */
export const REPORTING = ["stable", "beta"] as const;
export const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function keys(
  v: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k))
  );
}
/** A build's whole version as a report states it: a release's, or a track build's (version.rs). */
export const buildVersion = (v: unknown): v is string =>
  typeof v === "string" && (VERSION.test(v) || TRACK_VERSION.test(v));
/**
 * The system a report says it came from: a Mac's or Windows', either chip,
 * and that system's version as an update check names it
 * (docs/engineering/services-and-feedback.md#SERV-282).
 */
export function system(platform: unknown, arch: unknown, os: unknown): boolean {
  return supported(platform, arch, os);
}
/**
 * Where each system's copies come from, as a usage batch names it
 * (docs/engineering/services-and-feedback.md#SERV-282): a Mac's download,
 * signed with the Developer ID, or the Mac App Store's; Windows' download (its
 * installer, from the site, GitHub or winget) or the Microsoft Store's. A
 * channel is its own system's or the batch is refused.
 */
const CHANNELS: Record<System, readonly string[]> = {
  darwin: ["developer-id", "app-store"],
  windows: ["download", "microsoft-store"],
};
interface Batch {
  version: string;
  platform: string;
  arch: string;
  os: string;
  channel: string;
  events: { name: string; props: Record<string, string> }[];
  /** The values of `$released-version` properties, each to be a release. */
  releases: string[];
}
/**
 * The batch's shape, every event on the list. Whether its version, and each
 * version a property names, was released is asked of the lists afterwards
 * ([`counts`]), since they are read from R2.
 */
export function parseBatch(v: unknown): Batch {
  if (
    !object(v) ||
    !keys(v, ["version", "platform", "arch", "os", "channel", "events"]) ||
    !buildVersion(v.version) ||
    !system(v.platform, v.arch, v.os) ||
    !CHANNELS[v.platform as System].includes(v.channel as string) ||
    !Array.isArray(v.events) ||
    v.events.length < 1 ||
    v.events.length > 25
  )
    throw new Error("Invalid batch");
  const schema: Record<string, { props: Record<string, string[]> }> = events;
  const releases: string[] = [];
  const checked = v.events.map((event: unknown) => {
    if (
      !object(event) ||
      !keys(event, ["name", "props"]) ||
      typeof event.name !== "string" ||
      !Object.hasOwn(schema, event.name) ||
      !object(event.props)
    )
      throw new Error("Invalid event");
    const rule = schema[event.name].props;
    if (!keys(event.props, Object.keys(rule))) throw new Error("Invalid properties");
    const props: Record<string, string> = {};
    for (const key of Object.keys(rule).sort()) {
      const value = event.props[key];
      const release = rule[key][0] === "$released-version";
      if (typeof value !== "string" || !(release ? VERSION.test(value) : rule[key].includes(value)))
        throw new Error("Invalid property");
      if (release) releases.push(value);
      props[key] = value;
    }
    return { name: event.name, props };
  });
  return {
    version: v.version,
    platform: v.platform as string,
    arch: v.arch as string,
    os: v.os as string,
    channel: v.channel as string,
    events: checked,
    releases,
  };
}
export async function counts(
  request: Request,
  env: ReportsEnv,
  now: Date,
  source: Source,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.origin !== REPORTS ||
    url.pathname !== "/v1/events" ||
    url.search ||
    request.method !== "POST"
  )
    return response(404);
  if (env.EVENTS_ENABLED !== "true") return response(503);
  try {
    if (
      !(await env.EVENTS_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" }))
        .success
    )
      return response(429);
    if (request.headers.get("Content-Type") !== "application/json") return response(400);
    let bytes: Uint8Array;
    try {
      bytes = await boundedBytes(
        new Response(request.body, { headers: request.headers }),
        MAX_EVENTS_BODY,
      );
    } catch {
      return response(413);
    }
    let batch: Batch;
    try {
      batch = parseBatch(
        JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
      );
    } catch {
      return response(400);
    }
    // A list that cannot be read is the service's trouble, never the batch's:
    // it answers 503, and the app keeps the batch for later.
    const track = await releasedOn(env, source, batch.version, REPORTING);
    if (track === null) return response(400);
    for (const release of batch.releases)
      if ((await releasedOn(env, source, release, ["stable"])) === null) return response(400);
    const day = now.toISOString().slice(0, 10);
    const combinations = new Map<string, { name: string; props: string; count: number }>();
    for (const event of batch.events) {
      const props = JSON.stringify(event.props),
        key = JSON.stringify([event.name, props]);
      const value = combinations.get(key);
      if (value) value.count++;
      else combinations.set(key, { name: event.name, props, count: 1 });
    }
    // D1 batch is transactional. Nothing is written until every event has passed validation.
    const result = await env.DB.batch(
      [...combinations.values()].map((event) =>
        env.DB.prepare(`INSERT INTO usage_counts
      (day, version, platform, arch, os, channel, track, event, props, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, version, platform, arch, os, channel, event, props) DO UPDATE SET count = count + excluded.count`).bind(
          day,
          batch.version,
          batch.platform,
          batch.arch,
          batch.os,
          batch.channel,
          track,
          event.name,
          event.props,
          event.count,
        ),
      ),
    );
    return response(result.every((r) => r.success) ? 204 : 503);
  } catch {
    return response(503);
  }
}
export async function expireCounts(db: D1Database, now: Date): Promise<void> {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  const day = cutoff.toISOString().slice(0, 10);
  await db.batch([
    db.prepare("DELETE FROM update_counts WHERE day < ?").bind(day),
    db.prepare("DELETE FROM usage_counts WHERE day < ?").bind(day),
  ]);
}
