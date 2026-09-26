// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { boundedBytes, response } from "./updates";
import { REPORTS, object, keys, system, isReleased } from "./reports";
import names from "../crash-kinds.json";
export const CRASH_PATH = "/api/proscenium/envelope/";
export const MAX_CRASH_BODY = 64 * 1024;
export interface CrashEnv {
  CRASHES_ENABLED: string;
  CRASH_LIMIT: RateLimit;
  RELEASED_VERSIONS_JSON: string;
  SENTRY_DSN: string;
}
const encoder = new TextEncoder();
const id = /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const symbol = /^[A-Za-z0-9_:<>, &\[\](){}#;!?=-]{1,256}$/;
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10_000_000;
/** Rebuild the envelope after validation. Never forward unparsed bytes. */
export function parseEnvelope(
  bytes: Uint8Array,
  env: Pick<CrashEnv, "RELEASED_VERSIONS_JSON">,
  now: Date,
): Uint8Array {
  const lines = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
    .decode(bytes)
    .split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 3) throw new Error("Invalid envelope");
  const head: unknown = JSON.parse(lines[0]),
    item: unknown = JSON.parse(lines[1]),
    event: unknown = JSON.parse(lines[2]);
  if (
    !object(head) ||
    !keys(head, ["event_id"]) ||
    typeof head.event_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(head.event_id) ||
    !object(item) ||
    !keys(item, ["type", "length"]) ||
    item.type !== "event" ||
    item.length !== encoder.encode(lines[2]).byteLength ||
    !object(event) ||
    !keys(
      event,
      ["event_id", "release", "timestamp", "level", "exception", "tags"],
      ["platform"],
    ) ||
    typeof event.event_id !== "string" ||
    !id.test(event.event_id) ||
    event.event_id !== head.event_id.replaceAll("-", "") ||
    !isReleased(env, event.release) ||
    event.level !== "fatal" ||
    !(
      event.platform === undefined ||
      event.platform === "native" ||
      event.platform === "javascript"
    )
  )
    throw new Error("Invalid event");
  const today = Math.floor(now.getTime() / 86400_000) * 86400;
  if (
    typeof event.timestamp !== "number" ||
    !Number.isInteger(event.timestamp) ||
    event.timestamp % 86400 !== 0 ||
    event.timestamp > today ||
    event.timestamp < today - 7 * 86400
  )
    throw new Error("Invalid day");
  if (
    !object(event.tags) ||
    !keys(event.tags, ["app_platform", "arch", "os"]) ||
    !system(event.tags.app_platform, event.tags.arch, event.tags.os)
  )
    throw new Error("Invalid system");
  if (
    !object(event.exception) ||
    !keys(event.exception, ["values"]) ||
    !Array.isArray(event.exception.values) ||
    event.exception.values.length !== 1
  )
    throw new Error("Invalid exception");
  const ex: unknown = event.exception.values[0];
  const native = event.platform !== "javascript";
  if (
    !object(ex) ||
    !keys(ex, ["type", "stacktrace"]) ||
    typeof ex.type !== "string" ||
    (native ? ex.type !== "RustPanic" : !names.includes(ex.type)) ||
    !object(ex.stacktrace) ||
    !keys(ex.stacktrace, ["frames"]) ||
    !Array.isArray(ex.stacktrace.frames) ||
    ex.stacktrace.frames.length < 1 ||
    ex.stacktrace.frames.length > 64
  )
    throw new Error("Invalid stack");
  for (const frame of ex.stacktrace.frames as unknown[]) {
    if (
      !object(frame) ||
      !keys(frame, ["module"], ["function", "lineno", "colno"]) ||
      frame.module !== (native ? "native" : "webview") ||
      (frame.function !== undefined &&
        (!native ||
          typeof frame.function !== "string" ||
          !symbol.test(frame.function) ||
          !frame.function.includes("::"))) ||
      (frame.lineno !== undefined && !number(frame.lineno)) ||
      (frame.colno !== undefined && !number(frame.colno)) ||
      (frame.function === undefined && frame.lineno === undefined)
    )
      throw new Error("Invalid frame");
  }
  const body = JSON.stringify(event);
  return encoder.encode(
    `${JSON.stringify({ event_id: head.event_id })}\n${JSON.stringify({ type: "event", length: encoder.encode(body).length })}\n${body}\n`,
  );
}
export async function crashes(
  request: Request,
  env: CrashEnv,
  now: Date,
  forward: (bytes: Uint8Array, dsn: string) => Promise<number>,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.origin !== REPORTS ||
    url.pathname !== CRASH_PATH ||
    url.search ||
    request.method !== "POST"
  )
    return response(404);
  if (env.CRASHES_ENABLED !== "true") return response(503);
  try {
    if (
      !(await env.CRASH_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" }))
        .success
    )
      return response(429);
    if (request.headers.get("Content-Type") !== "application/x-sentry-envelope")
      return response(400);
    let bytes: Uint8Array;
    try {
      bytes = await boundedBytes(
        new Response(request.body, { headers: request.headers }),
        MAX_CRASH_BODY,
      );
    } catch {
      return response(413);
    }
    try {
      bytes = parseEnvelope(bytes, env, now);
    } catch {
      return response(400);
    }
    const status = await forward(bytes, env.SENTRY_DSN);
    if (status >= 200 && status < 300) return response(204);
    return response(
      status === 429 ? 429 : status >= 500 || (status >= 300 && status < 400) ? 503 : 400,
    );
  } catch {
    return response(503);
  }
}
