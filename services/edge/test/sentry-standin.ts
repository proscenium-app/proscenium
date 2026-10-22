// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sentry's ingest, on loopback, for the stand-in
 * (docs/engineering/services-and-feedback.md#SERV-279):
 *
 *   bun test/sentry-standin.ts
 *
 * It listens where the stand-in's `SENTRY` var says, takes each envelope the
 * stand-in Worker forwards to `/api/<project>/envelope/`, and appends one line
 * for its event to `.wrangler/standin/sentry.jsonl`: when it came, its release,
 * its day (the crash's `timestamp`, which says the UTC day and never the hour),
 * and the exception's first line, which is its kind and where it stopped. The
 * stand-in's reader (test/standin-evidence.ts) counts those lines as Sentry
 * would count the events.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { listening, SENTRY_LOG, standInConfig } from "./standin.ts";

/** One crash report as the Sentry stand-in keeps it. */
export interface Received {
  v: 1;
  received: string;
  release: string;
  timestamp: number;
  exception: string;
}
interface Frame {
  module?: string;
  function?: string;
  lineno?: number;
  colno?: number;
}
/**
 * The line an envelope makes: the Worker has validated and rebuilt it, so its
 * three lines are the header, the item and one event. The crash stopped in its
 * stack trace's last frame, the innermost, as Sentry orders them.
 */
export function received(envelope: string, at: Date): Received {
  const event = JSON.parse(envelope.trimEnd().split("\n")[2] ?? "null") as {
    release?: unknown;
    timestamp?: unknown;
    exception?: { values?: { type?: unknown; stacktrace?: { frames?: Frame[] } }[] };
  } | null;
  const exception = event?.exception?.values?.[0];
  if (
    typeof event?.release !== "string" ||
    typeof event.timestamp !== "number" ||
    typeof exception?.type !== "string"
  )
    throw new Error("Not an event envelope");
  const frame = exception.stacktrace?.frames?.at(-1);
  const where = frame?.function ?? (frame ? `${frame.module} ${frame.lineno}:${frame.colno}` : "");
  return {
    v: 1,
    received: at.toISOString(),
    release: event.release,
    timestamp: event.timestamp,
    exception: where ? `${exception.type} at ${where}` : exception.type,
  };
}

if (import.meta.main) {
  const { hostname, port } = listening(standInConfig().vars.SENTRY);
  mkdirSync(dirname(SENTRY_LOG), { recursive: true });
  Bun.serve({
    hostname,
    port,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !/^\/api\/[1-9]\d*\/envelope\/$/.test(path))
        return new Response(null, { status: 404 });
      try {
        const line = received(await request.text(), new Date());
        appendFileSync(SENTRY_LOG, `${JSON.stringify(line)}\n`);
        return Response.json({ id: "stand-in" });
      } catch {
        return new Response(null, { status: 400 });
      }
    },
  });
  console.log(`Sentry stand-in at http://${hostname}:${port}, keeping ${SENTRY_LOG}.`);
}
