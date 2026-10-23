// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * GitHub's releases, on loopback, for a local Worker. Two kinds:
 *
 *   bun test/github-standin.ts [dir]              the rehearsal's (wrangler.local.jsonc): one rehearsal
 *                                                 build, where test/rehearsal-entry.ts sends github.com
 *   bun test/github-standin.ts --stand-in dir...  the stand-in's (wrangler.standin.jsonc): each release
 *                                                 build given, at the address its GITHUB var names, the
 *                                                 newest as `latest`
 *
 * A stand-in's manifests are served with every archive's address at this
 * server, whatever each build's own latest.json names (test/standin.ts).
 */
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { GITHUB, ownFile, parseManifest } from "../src/updates";
import { compareReleases, releaseManifest, standInConfig } from "./standin";

/**
 * A release's assets beside its build's three files and its manifest: GitHub
 * serves every file a release holds (scripts/release.mjs drafts seven), and
 * the checks from outside read its SHA256SUMS there.
 */
const RELEASE_ASSETS = ["SHA256SUMS", "notes.md", "build.json"];

const args = process.argv.slice(2);
if (args[0] === "--stand-in") standIn(args.slice(1));
else rehearsal(args[0]);

function rehearsal(dir: string | undefined) {
  const directory = resolve(dir ?? "../../.release-artifacts/v0.1.0-rehearsal");
  const build = JSON.parse(readFileSync(join(directory, "build.json"), "utf8")) as {
    rehearsal?: boolean;
  };
  if (build.rehearsal !== true) throw new Error("Only rehearsal artifacts may be served");
  const latest = parseManifest(JSON.parse(readFileSync(join(directory, "latest.json"), "utf8")));
  const prefix = new URL(GITHUB).pathname;
  Bun.serve({
    hostname: "127.0.0.1",
    port: 8791,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET") return new Response(null, { status: 404 });
      if (url.pathname === "/fallback/latest.json") {
        const fallback = structuredClone(latest);
        for (const p of Object.values(fallback.platforms) as { url: string }[])
          p.url = `http://127.0.0.1:8791${new URL(p.url).pathname}`;
        return Response.json(fallback);
      }
      if (
        [
          `${prefix}/latest/download/latest.json`,
          `${prefix}/download/v${latest.version}/latest.json`,
        ].includes(url.pathname)
      )
        return Response.json(latest);
      const file = url.pathname.slice(`${prefix}/download/v${latest.version}/`.length);
      if (
        !url.pathname.startsWith(`${prefix}/download/v${latest.version}/`) ||
        !ownFile(latest.version, file)
      )
        return new Response(null, { status: 404 });
      return new Response(Bun.file(join(directory, file)));
    },
  });
  console.log("GitHub stand-in on loopback port 8791; rehearsal artifacts only.");
}

function standIn(dirs: string[]) {
  if (!dirs.length) throw new Error("Name at least one release build's folder");
  const github = standInConfig().vars.GITHUB;
  const address = new URL(github);
  if (address.hostname !== "127.0.0.1")
    throw new Error("The GitHub stand-in serves loopback alone");
  const releases = new Map(
    dirs.map((dir) => {
      const directory = resolve(dir);
      const manifest = releaseManifest(
        JSON.parse(readFileSync(join(directory, "latest.json"), "utf8")),
        github,
      );
      return [manifest.version, { directory, manifest }] as const;
    }),
  );
  const versions = [...releases.keys()].sort(compareReleases);
  const newest = versions[versions.length - 1];
  const prefix = address.pathname;
  Bun.serve({
    hostname: "127.0.0.1",
    port: Number(address.port),
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET" || !path.startsWith(`${prefix}/`))
        return new Response(null, { status: 404 });
      if (path === `${prefix}/latest/download/latest.json`)
        return Response.json(releases.get(newest)?.manifest);
      const [, version, file] =
        /^\/download\/v([^/]+)\/([^/]+)$/.exec(path.slice(prefix.length)) ?? [];
      const release = version === undefined ? undefined : releases.get(version);
      if (!release) return new Response(null, { status: 404 });
      if (file === "latest.json") return Response.json(release.manifest);
      if (!ownFile(version, file) && !RELEASE_ASSETS.includes(file))
        return new Response(null, { status: 404 });
      const served = Bun.file(join(release.directory, file));
      return served.size ? new Response(served) : new Response(null, { status: 404 });
    },
  });
  console.log(`GitHub stand-in at ${github}: ${versions.join(", ")}, the newest ${newest}.`);
}
