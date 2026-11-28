#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Xcode the iPad's app is built with, which need not be the one the Mac's
 * is.
 *
 *   node scripts/ios-xcode.mjs                 say which Xcode the iPad's build uses
 *   node scripts/ios-xcode.mjs -- <command…>   run the command with that Xcode
 *
 * WHY THE IPAD HAS ITS OWN
 * ------------------------
 * The App Store takes an iPad upload only when it is built with a recent
 * enough iOS SDK, and an SDK comes inside one Xcode. The Mac's releases are
 * proven against the Xcode a host has selected, its Intel slice included, and
 * moving that is a proof of its own. So a build host may hold two: the one
 * `xcode-select` names, which every Mac build uses, and a newer one beside it
 * at `IOS_XCODE`, which the iPad's build, its simulator pass and its compile
 * gate use, chosen for their commands alone.
 *
 * It is chosen twice over, because one way does not reach everything. Apple's
 * own tools on the path (`xcrun`, `xcodebuild`) follow `DEVELOPER_DIR`. The
 * Tauri CLI, though, hands `xcodebuild` a short list of variables that leaves
 * `DEVELOPER_DIR` out and keeps `PATH`; so that Xcode's own `usr/bin` goes
 * first on `PATH` as well, where its `xcodebuild` is found before the system's
 * and builds with the Xcode it sits in, whatever is selected. With only the
 * variable set, a build went through the selected Xcode and its older SDK
 * unseen; the bundle's check below is what caught it.
 *
 * Where there is no second Xcode (a contributor's Mac with one, new enough),
 * the selected one is used and nothing is set. Which SDK made a build is then
 * held where it shows: scripts/check-bundle-ios.mjs refuses an iPad build
 * whose SDK is older than `IOS_SDK_FLOOR`, whichever Xcode made it.
 *
 * `PROSCENIUM_IOS_DEVELOPER_DIR` names another Developer directory, for a
 * host that keeps its Xcodes elsewhere.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where a build host keeps the iPad's Xcode, beside the one it has selected. */
export const IOS_XCODE = "/Applications/Xcode-27.app";

/** The oldest iOS SDK an iPad build may be made with: the App Store's, from April 2027. */
export const IOS_SDK_FLOOR = 27;

/**
 * The Developer directory the iPad's commands run with, or null for the
 * selected Xcode's.
 */
export function iosDeveloperDir(env = process.env, exists = existsSync) {
  const named = env.PROSCENIUM_IOS_DEVELOPER_DIR;
  if (named) return named;
  const beside = `${IOS_XCODE}/Contents/Developer`;
  return exists(beside) ? beside : null;
}

/**
 * The environment an iPad command runs in: the given one, with the iPad's Xcode
 * chosen by `DEVELOPER_DIR` and by its tools standing first on `PATH`.
 */
export function iosEnv(env = process.env, exists = existsSync) {
  const dir = iosDeveloperDir(env, exists);
  if (!dir) return { ...env };
  const bin = `${dir}/usr/bin`;
  const rest = (env.PATH ?? "").split(":").filter((p) => p && p !== bin);
  return { ...env, DEVELOPER_DIR: dir, PATH: [bin, ...rest].join(":") };
}

/**
 * What is wrong with the SDK a built app says it was made with
 * (`DTPlatformVersion`, or the number in `DTSDKName`): nothing, or one line.
 */
export function sdkProblems(info, floor = IOS_SDK_FLOOR) {
  const said = info?.DTPlatformVersion ?? String(info?.DTSDKName ?? "").replace(/^[a-z]+/i, "");
  const major = Number.parseInt(said, 10);
  if (!Number.isFinite(major))
    return ["Info.plist does not say which SDK built it (DTPlatformVersion, DTSDKName)"];
  if (major < floor)
    return [
      `built with the iOS ${said} SDK, and an iPad build needs iOS ${floor} or later: ` +
        `an Xcode that has it at ${IOS_XCODE}, or named by PROSCENIUM_IOS_DEVELOPER_DIR`,
    ];
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The command is what follows the leading `--`. A runtime that takes that
  // `--` for itself leaves the command alone after the script, which is read
  // the same; a later `--` is the command's own, and goes to it.
  const given = process.argv.slice(2);
  const [command, ...rest] = given[0] === "--" ? given.slice(1) : given;
  const dir = iosDeveloperDir();
  if (!command) {
    console.log(
      dir
        ? `ios-xcode: the iPad's build uses ${dir}`
        : `ios-xcode: no Xcode at ${IOS_XCODE}; the iPad's build uses the selected one`,
    );
  } else {
    const r = spawnSync(command, rest, { stdio: "inherit", env: iosEnv() });
    if (r.error) {
      console.error(`ios-xcode: ${command}: ${r.error.message}`);
      process.exit(127);
    }
    process.exit(r.status ?? 1);
  }
}
