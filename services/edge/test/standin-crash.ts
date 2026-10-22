// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A crash report from a stand-in build, as a copy's crash reporter sends it
 * (docs/engineering/services-and-feedback.md#SERV-279), for a stand-in run to
 * plant:
 *
 *   bun test/standin-crash.ts --version <version>           POST it to the stand-in, print the answer
 *   bun test/standin-crash.ts --version <version> --print   print its headers and body instead
 *
 * One JavaScript crash (`TypeError`, stopped at webview line 1, column 234),
 * dated today as every report is (the UTC day at midnight), with a fresh id.
 * The Worker takes it only from a version its lists released: a published
 * beta's is taken and forwarded to the Sentry stand-in, any other refused 400.
 */
import { listening, standInConfig } from "./standin.ts";

/** The crash route's one header. */
export const CRASH_HEADERS = { "Content-Type": "application/x-sentry-envelope" } as const;

/** The system a crash says it came from: a Mac's, unless a Windows copy's is given. */
export interface CrashSystem {
  app_platform: string;
  arch: string;
  os: string;
}
/**
 * A crash envelope from `version`, dated the UTC day of `now`, byte for byte
 * as the app's reporter writes one, from a Mac or the system `tags` names
 * (docs/engineering/services-and-feedback.md#SERV-282).
 */
export function crashEnvelope(
  version: string,
  now = new Date(),
  id = crypto.randomUUID(),
  tags: CrashSystem = { app_platform: "darwin", arch: "aarch64", os: "26.0" },
): string {
  const event = JSON.stringify({
    event_id: id.replaceAll("-", ""),
    level: "fatal",
    platform: "javascript",
    timestamp: Math.floor(now.getTime() / 86_400_000) * 86_400,
    release: version,
    exception: {
      values: [
        {
          type: "TypeError",
          stacktrace: { frames: [{ module: "webview", lineno: 1, colno: 234 }] },
        },
      ],
    },
    tags,
  });
  const length = new TextEncoder().encode(event).byteLength;
  return `${JSON.stringify({ event_id: id })}\n${JSON.stringify({ type: "event", length })}\n${event}\n`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const version = args[args.indexOf("--version") + 1];
  if (!args.includes("--version") || !version) throw new Error("Name the version: --version <v>");
  const body = crashEnvelope(version);
  const updates = standInConfig().vars.UPDATES;
  listening(updates); // loopback, or it throws
  const address = `${updates}/api/proscenium/envelope/`;
  if (args.includes("--print")) {
    console.log(`POST ${address}`);
    for (const [name, value] of Object.entries(CRASH_HEADERS)) console.log(`${name}: ${value}`);
    console.log(`\n${body}`);
  } else {
    const r = await fetch(address, { method: "POST", headers: CRASH_HEADERS, body });
    console.log(`${r.status} from ${address}`);
    process.exitCode = r.status === 204 ? 0 : 1;
  }
}
