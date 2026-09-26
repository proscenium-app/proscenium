// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve, join } from "node:path";
import { GITHUB, ownFile, parseManifest } from "../src/updates";
const directory = resolve(process.argv[2] ?? "../../.release-artifacts/v0.1.0-rehearsal");
const build = JSON.parse(await Bun.file(join(directory, "build.json")).text()) as { rehearsal?: boolean };
if (build.rehearsal !== true) throw new Error("Only rehearsal artifacts may be served");
const latest = parseManifest(JSON.parse(await Bun.file(join(directory, "latest.json")).text()));
const prefix = new URL(GITHUB).pathname;
Bun.serve({ hostname: "127.0.0.1", port: 8791, fetch(request) {
  const url = new URL(request.url);
  if (request.method !== "GET") return new Response(null, { status: 404 });
  if (url.pathname === "/fallback/latest.json") {
    const fallback = structuredClone(latest);
    for (const p of Object.values(fallback.platforms) as {url: string}[]) p.url = `http://127.0.0.1:8791${new URL(p.url).pathname}`;
    return Response.json(fallback);
  }
  if ([`${prefix}/latest/download/latest.json`, `${prefix}/download/v${latest.version}/latest.json`].includes(url.pathname)) return Response.json(latest);
  const file = url.pathname.slice(`${prefix}/download/v${latest.version}/`.length);
  if (!url.pathname.startsWith(`${prefix}/download/v${latest.version}/`) || !ownFile(latest.version, file)) return new Response(null, { status: 404 });
  return new Response(Bun.file(join(directory, file)));
} });
console.log("GitHub stand-in on loopback port 8791; rehearsal artifacts only.");
