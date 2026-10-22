// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/** R2 and the edge cache as the Worker reads them, over maps, for the routes' tests. */
import { UPDATES, type Env, type Source } from "../src/updates";

/** R2 as the Worker reads it: `get` and nothing else. */
export function bucket(objects: Map<string, string>): Env["TRACKS"] {
  return {
    async get(key: string) {
      const text = objects.get(key);
      return text === undefined
        ? null
        : {
            body: new Response(text).body as ReadableStream,
            size: new TextEncoder().encode(text).byteLength,
          };
    },
  } as unknown as Env["TRACKS"];
}
/** The edge cache, which never expires here: clearing it is the minute passing. */
export function memoryCache(entries: Map<string, Response>): Pick<Cache, "match" | "put"> {
  const key = (r: RequestInfo | URL) =>
    typeof r === "string" ? r : r instanceof URL ? r.href : r.url;
  return {
    async match(r) {
      return entries.get(key(r))?.clone();
    },
    async put(r, response) {
      entries.set(key(r), response.clone());
    },
  };
}
/** Where a route reads the lists, as production's entry makes it, and what it said. */
export function lists(objects = new Map<string, string>(), prefix = "") {
  const cache = new Map<string, Response>();
  const said: string[] = [];
  const source: Source = {
    bucket: bucket(objects),
    cache: memoryCache(cache),
    origin: UPDATES,
    prefix,
    log: (line) => said.push(line),
  };
  return { objects, cache, said, source };
}
/** An admission list as the release writes it. */
export function admissionList(
  stable: string[],
  halted: { version: string; track: string }[] = [],
): string {
  return JSON.stringify({
    v: 1,
    stable,
    halted: halted.map((h) => ({ ...h, at: "2026-10-09T14:00:00Z", why: "It crashes on open." })),
  });
}
