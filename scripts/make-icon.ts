// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every icon Proscenium ships, from the one description of the mark in
 * src/ui/app-mark.ts (docs/engineering/release-engineering.md#REL-D7). Run via `bun run icon`.
 *
 *   src-tauri/icons/Proscenium.svg     the flat mark, light. `tauri icon` renders
 *                                      the .icns, .ico, PNGs and the iPad set from it.
 *   src-tauri/icons/Proscenium.icon/   the Icon Composer document: arch, stage and
 *                                      strip as flat layers, light, dark and tinted.
 *   src-tauri/icons/Assets.car         that document compiled by Xcode 26's actool:
 *                                      the icon macOS 26 draws in light, dark,
 *                                      tinted and clear, with flat bitmaps for
 *                                      macOS 14 and 15. tauri.conf.json lists it,
 *                                      so every build embeds it BEFORE signing.
 *
 * The last point is why this moved out of scripts/install-app.mjs, which used to
 * compile the icon into the finished app and re-sign it: a bundle changed after
 * signing is a broken Developer ID signature, and the signed release never had
 * the adaptive icon at all.
 *
 * **Nothing is rewritten that did not change.** `app:install` and the build
 * scripts run this every time, and in a watched tree a rewrite is an event.
 * Two outputs cannot be compared by their bytes:
 *   - `tauri icon` packs the .icns differently on every run, so it runs only
 *     when Proscenium.svg changed, or part of its set is missing;
 *   - actool writes a slightly different Assets.car on every run (timestamps,
 *     generated names), so it runs only when the document's inputs hash
 *     differently from the hash recorded beside it, Proscenium.icon.sha256.
 *
 *   bun run icon             bring everything in line with app-mark.ts
 *   bun run icon -- --force  rebuild all of it anyway
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APP_MARK, type AppMarkPalette } from "../src/ui/app-mark.ts";

const ROOT = resolve(import.meta.dir, "..");
const ICONS = join(ROOT, "src-tauri/icons");
const DOC = join(ICONS, "Proscenium.icon");
const FORCE = process.argv.includes("--force");

function writeIfChanged(path: string, content: string | Buffer): boolean {
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  if (existsSync(path) && readFileSync(path).equals(bytes)) return false;
  writeFileSync(path, bytes);
  console.log(`icon: wrote ${path.slice(ROOT.length + 1)}`);
  return true;
}

// --- the SVGs --------------------------------------------------------------

const { tile, strip, layers } = APP_MARK;

const svg = (viewBox: string, body: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${APP_MARK.canvas}" height="${APP_MARK.canvas}" viewBox="${viewBox}">\n` +
  body.map((line) => `  ${line}`).join("\n") +
  "\n</svg>\n";

/** The whole icon on the 1024 canvas, transparent outside macOS's 824 tile. */
function appIcon(c: AppMarkPalette): string {
  return svg(`0 0 ${APP_MARK.canvas} ${APP_MARK.canvas}`, [
    `<rect x="${tile.x}" y="${tile.y}" width="${tile.size}" height="${tile.size}" rx="${tile.radius}" fill="${c.tile}"/>`,
    `<path fill-rule="evenodd" fill="${c.arch}" d="${APP_MARK.arch}"/>`,
    `<path fill="${c.stage}" d="${APP_MARK.stage}"/>`,
    `<rect x="${strip.x}" y="${strip.y}" width="${strip.width}" height="${strip.height}" fill="${c.strip}"/>`,
  ]);
}

/**
 * One Icon Composer layer: a black shape on the tile's own canvas (Icon
 * Composer's 1024 IS the tile), recoloured per appearance by the document.
 */
const layer = (shape: string) => svg(`${tile.x} ${tile.y} ${tile.size} ${tile.size}`, [shape]);

// --- the Icon Composer document ----------------------------------------------

const srgb = (hex: string) =>
  `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
const grey = (v: number) => `srgb:${v.toFixed(5)},${v.toFixed(5)},${v.toFixed(5)},1.00000`;

/**
 * Light, dark, and a tinted value. A tinted rendition works from luminance, and
 * from the light colours the ink arch all but vanishes into the tint, so tinted
 * has its own: the arch brightest, the stage a mid-grey, the strip between.
 */
function fill(key: keyof AppMarkPalette, tinted?: string) {
  return {
    "fill-specializations": [
      { value: { solid: srgb(APP_MARK.light[key]) } },
      { appearance: "dark", value: { solid: srgb(APP_MARK.dark[key]) } },
      ...(tinted ? [{ appearance: "tinted", value: { solid: tinted } }] : []),
    ],
  };
}

/**
 * Flat under Liquid Glass: no glass on any layer, no shadow on the group. (With
 * glass off, specular and translucency change nothing; they are set off anyway
 * so the document says what it means.) The first layer is the frontmost.
 */
const document = {
  ...fill("tile"),
  groups: [
    {
      layers: [
        { ...fill("arch", grey(1)), glass: false, "image-name": "arch.svg", name: "arch" },
        { ...fill("strip", grey(0.85)), glass: false, "image-name": "strip.svg", name: "strip" },
        { ...fill("stage", grey(0.4)), glass: false, "image-name": "stage.svg", name: "stage" },
      ],
      name: "mark",
      shadow: { kind: "none", opacity: 0.5 },
      specular: false,
      translucency: { enabled: false, value: 0.5 },
    },
  ],
  "supported-platforms": { squares: "shared" },
};

// --- write ---------------------------------------------------------------------

mkdirSync(join(DOC, "Assets"), { recursive: true });
const svgChanged = writeIfChanged(join(ICONS, "Proscenium.svg"), appIcon(APP_MARK.light));
writeIfChanged(join(DOC, "icon.json"), `${JSON.stringify(document, null, 2)}\n`);
writeIfChanged(join(DOC, "Assets/arch.svg"), layer(`<path fill-rule="evenodd" d="${APP_MARK.arch}"/>`));
writeIfChanged(join(DOC, "Assets/stage.svg"), layer(`<path d="${layers.stage}"/>`));
writeIfChanged(
  join(DOC, "Assets/strip.svg"),
  layer(`<rect x="${layers.strip.x}" y="${layers.strip.y}" width="${layers.strip.width}" height="${layers.strip.height}"/>`),
);
// Layers the document no longer names are not left behind for actool to find.
for (const f of readdirSync(join(DOC, "Assets"))) {
  if (!["arch.svg", "stage.svg", "strip.svg"].includes(f)) {
    rmSync(join(DOC, "Assets", f));
    console.log(`icon: removed Proscenium.icon/Assets/${f}`);
  }
}

// --- tauri icon ------------------------------------------------------------------

const DERIVED = ["icon.icns", "icon.ico", "icon.png", "32x32.png", "128x128.png", "128x128@2x.png"];
const missing = DERIVED.filter((f) => !existsSync(join(ICONS, f)));
if (svgChanged || missing.length || FORCE) {
  if (missing.length) console.log(`icon: regenerating the set (missing ${missing.join(", ")})`);
  // The local binary rather than `bunx tauri`: PATH is the thing that differs
  // between a terminal, an installer and a hook. The iPad set is full-bleed,
  // so its corners take the tile's colour instead of iOS's white.
  execFileSync(
    join(ROOT, "node_modules/.bin/tauri"),
    ["icon", join(ICONS, "Proscenium.svg"), "--ios-color", APP_MARK.light.tile],
    { stdio: "inherit", cwd: ROOT },
  );
} else {
  console.log("icon: Proscenium.svg unchanged — keeping the rendered set as committed");
}

// --- Assets.car --------------------------------------------------------------------

const STAMP = join(ICONS, "Proscenium.icon.sha256");
const CAR = join(ICONS, "Assets.car");

function documentHash(): string {
  const hash = createHash("sha256");
  for (const f of ["icon.json", "Assets/arch.svg", "Assets/stage.svg", "Assets/strip.svg"]) {
    hash.update(f).update(readFileSync(join(DOC, f)));
  }
  return hash.digest("hex");
}

/** Xcode 26's actool, whether or not Xcode is the selected developer directory. */
function findActool(): { path: string; env: NodeJS.ProcessEnv } | null {
  const candidates: NodeJS.ProcessEnv[] = [process.env, { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" }];
  for (const env of candidates) {
    try {
      const path = execFileSync("xcrun", ["--find", "actool"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }).trim();
      const version = execFileSync(path, ["--version"], { encoding: "utf8", env });
      const major = Number(version.match(/<key>short-bundle-version<\/key>\s*<string>(\d+)/)?.[1] ?? 0);
      if (major >= 26) return { path, env };
    } catch {
      /* not this developer directory */
    }
  }
  return null;
}

const want = documentHash();
const recorded = existsSync(STAMP) ? readFileSync(STAMP, "utf8").split(/\s/)[0] : "";
if (recorded === want && existsSync(CAR) && !FORCE) {
  console.log("icon: Proscenium.icon unchanged — keeping Assets.car as committed");
} else {
  const actool = findActool();
  if (!actool) {
    console.error(
      "icon: Proscenium.icon changed, and Assets.car has to be recompiled with Xcode 26's actool, which this\n" +
        "      Mac does not have. Run `bun run icon` on a Mac with Xcode 26 and commit Assets.car with the document.",
    );
    process.exit(1);
  }
  const out = mkdtempSync(join(tmpdir(), "proscenium-icon-"));
  try {
    // Absolute paths only: actool hands the work to a long-lived ibtoold, which
    // resolves relative ones against ITS working directory, not this one.
    execFileSync(
      actool.path,
      [
        DOC,
        "--compile", out,
        "--output-format", "human-readable-text",
        "--errors", "--warnings",
        "--platform", "macosx",
        "--target-device", "mac",
        // The floor, so the catalog carries flat bitmaps for Sonoma and Sequoia,
        // which cannot draw an Icon Composer icon themselves.
        "--minimum-deployment-target", "14.0",
        // Must match the document's name, or actool succeeds and writes nothing.
        "--app-icon", "Proscenium",
        "--include-all-app-icons",
        "--output-partial-info-plist", join(out, "partial.plist"),
      ],
      { stdio: ["ignore", "ignore", "inherit"], env: actool.env },
    );
    if (!existsSync(join(out, "Assets.car"))) throw new Error("actool wrote no Assets.car");
    const info = execFileSync("assetutil", ["--info", join(out, "Assets.car")], { encoding: "utf8" });
    for (const appearance of ["NSAppearanceNameDarkAqua", "ISAppearanceTintable"]) {
      if (!info.includes(appearance)) throw new Error(`Assets.car has no ${appearance} rendition`);
    }
    copyFileSync(join(out, "Assets.car"), CAR);
    writeFileSync(STAMP, `${want}  Proscenium.icon, compiled into Assets.car\n`);
    console.log("icon: compiled Assets.car (light, dark, tinted; flat bitmaps for macOS 14 and 15)");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
