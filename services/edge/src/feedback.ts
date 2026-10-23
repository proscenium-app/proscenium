// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { boundedBytes, json, response, TRACK_VERSION, VERSION } from "./updates";
export const FEEDBACK = "https://feedback.proscenium.ink";
export const MAX_BODY = 1024 * 1024;
export interface Message {
  id: string;
  message: string;
  email?: string;
  details?: string;
  /**
   * The whole build version the message was sent from, when the copy says it
   * (docs/engineering/services-and-feedback.md#SERV-273): a release's `X.Y.Z`,
   * or a track build's `X.Y.Z-beta.N` or `X.Y.Z-alpha.N`.
   */
  version?: string;
}
export interface FeedbackEnv {
  DB: D1Database;
  FEEDBACK_LIMIT: RateLimit;
  FEEDBACK_ENABLED: string;
}
/** The list is the inbox: a message is stored, and nothing is sent anywhere. */
export interface FeedbackDependencies {
  now: () => Date;
}
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export function emailAllowed(email: string): boolean {
  return (
    email.length <= 254 &&
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
      email,
    )
  );
}
export function parseMessage(value: unknown): Message {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid message.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !["id", "message", "email", "details", "version"].includes(k)))
    throw new Error("Unexpected field.");
  if (
    typeof v.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.id)
  )
    throw new Error("Invalid submission id.");
  if (typeof v.message !== "string" || !v.message.trim()) throw new Error("Write a message first.");
  let count = 0;
  for (const _ of segmenter.segment(v.message))
    if (++count > 10_000) throw new Error("Shorten your message to 10,000 characters to send.");
  if (v.email !== undefined && (typeof v.email !== "string" || !emailAllowed(v.email)))
    throw new Error("Check your email address.");
  if (
    v.details !== undefined &&
    (typeof v.details !== "string" || new TextEncoder().encode(v.details).length > 65536)
  )
    throw new Error("Technical details are too long.");
  if (
    v.version !== undefined &&
    (typeof v.version !== "string" || !(VERSION.test(v.version) || TRACK_VERSION.test(v.version)))
  )
    throw new Error("Invalid version.");
  return {
    id: v.id,
    message: v.message,
    ...(typeof v.email === "string" ? { email: v.email } : {}),
    ...(typeof v.details === "string" ? { details: v.details } : {}),
    ...(typeof v.version === "string" ? { version: v.version } : {}),
  };
}
export async function feedback(
  request: Request,
  env: FeedbackEnv,
  deps: FeedbackDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.origin !== FEEDBACK ||
    url.pathname !== "/v1/messages" ||
    url.search ||
    request.method !== "POST"
  )
    return response(404);
  if (env.FEEDBACK_ENABLED !== "true") return response(503);
  try {
    if (
      !(await env.FEEDBACK_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" }))
        .success
    )
      return response(429);
    if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json")
      return json(400, { reason: "Expected a plain-text feedback message in JSON." });
    let bytes: Uint8Array;
    try {
      bytes = await boundedBytes(
        new Response(request.body, { headers: request.headers }),
        MAX_BODY,
      );
    } catch {
      return json(413, { reason: "This message is too large to send." });
    }
    let message: Message;
    try {
      message = parseMessage(
        JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
      );
    } catch (error) {
      return json(400, {
        reason:
          error instanceof SyntaxError || error instanceof TypeError
            ? "Invalid message."
            : (error as Error).message,
      });
    }
    const result = await env.DB.prepare(`INSERT INTO feedback_messages
      (id, message, email, details, received_day, version)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(
        message.id,
        message.message,
        message.email ?? null,
        message.details ?? null,
        deps.now().toISOString().slice(0, 10),
        message.version ?? null,
      )
      .run();
    if (!result.success) return response(503);
    return json(201, { id: message.id });
  } catch {
    return response(503);
  }
}
/** One year in the private list. The maintainer's scheduled jobs delete their copies on the same schedule. */
export async function expireFeedback(db: D1Database, now: Date): Promise<void> {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  await db
    .prepare("DELETE FROM feedback_messages WHERE received_day < ?")
    .bind(cutoff.toISOString().slice(0, 10))
    .run();
}
