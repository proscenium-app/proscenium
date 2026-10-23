// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seed the stand-in's local R2 and D1 (docs/engineering/services-and-feedback.md#SERV-274):
 *
 *   bun test/standin-seed.ts [--admission <file>] [<track build folder>...]
 *
 * The local database gets its migrations; the admission list, checked as the
 * Worker reads it, goes to `stand-in/admission.json`; and each track build
 * (a folder release.mjs wrote for alpha or beta) its three files to
 * `stand-in/<track>/<version>/`, then its track's list of the versions given,
 * then the newest one's manifest as the build wrote it (the Worker answers it
 * on its own origin), in the order the pipeline writes them. Releases are
 * GitHub's: serve those with `bun test/github-standin.ts --stand-in`.
 *
 * Local only, into `.wrangler/standin`, where `bun run dev:standin` reads:
 * every Wrangler call here says `--local`, and none is given a token.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseAdmission, trackOf } from "../src/updates";
import { localWrangler, STANDIN_STATE, standInConfig, trackManifest } from "./standin";

const config = standInConfig();
const bucket = config.r2_buckets[0].bucket_name;
const database = config.d1_databases[0].database_name;
const prefix = config.vars.KEY_PREFIX;

function put(key: string, file: string) {
  localWrangler(["r2", "object", "put", `${bucket}/${prefix}${key}`, "--file", file]);
  console.log(`  put ${prefix}${key}`);
}

const args = process.argv.slice(2);
const at = args.indexOf("--admission");
const admission = at === -1 ? null : args.splice(at, 2)[1];
const temp = mkdtempSync(join(tmpdir(), "proscenium-standin-"));
try {
  localWrangler(["d1", "migrations", "apply", database]);
  if (admission !== null) {
    // Refused here rather than taken as empty by the Worker.
    parseAdmission(JSON.parse(readFileSync(admission, "utf8")));
    put("admission.json", resolve(admission));
  }
  const builds = args.map((dir) => {
    const directory = resolve(dir);
    const latest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
    const track = trackOf(String(latest.version));
    if (track === null) throw new Error(`${dir} is not a track build: releases are GitHub's`);
    return { directory, latest, track, version: String(latest.version) };
  });
  for (const track of ["alpha", "beta"] as const) {
    const given = builds
      .filter((b) => b.track === track)
      .sort((a, b) => Number(a.version.split(".").at(-1)) - Number(b.version.split(".").at(-1)));
    if (!given.length) continue;
    for (const b of given)
      for (const file of [
        ...["aarch64", "universal"].flatMap((slice) => [
          `Proscenium_${b.version}_${slice}.dmg`,
          `Proscenium_${b.version}_${slice}.app.tar.gz`,
          `Proscenium_${b.version}_${slice}.app.tar.gz.sig`,
        ]),
        // Windows' installers, when the build carries Windows
        // (docs/engineering/services-and-feedback.md#SERV-283).
        ...["x64", "arm64"].flatMap((chip) => [
          `Proscenium_${b.version}_${chip}-setup.exe`,
          `Proscenium_${b.version}_${chip}-setup.exe.sig`,
        ]),
      ])
        if (existsSync(join(b.directory, file)))
          put(`${track}/${b.version}/${file}`, join(b.directory, file));
    const list = join(temp, `${track}-versions.json`);
    writeFileSync(list, `${JSON.stringify(given.map((b) => b.version))}\n`);
    put(`${track}/versions.json`, list);
    const manifest = join(temp, `${track}-latest.json`);
    writeFileSync(
      manifest,
      `${JSON.stringify(trackManifest(given[given.length - 1].latest, config.vars.UPDATES))}\n`,
    );
    put(`${track}/latest.json`, manifest);
  }
  console.log(`The stand-in's local state is seeded (${STANDIN_STATE}).`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
