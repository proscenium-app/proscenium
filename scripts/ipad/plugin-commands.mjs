// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every command of the folder-picker plugin is in a built iPad app.
 *
 * The plugin's commands are `@objc` methods in extensions of its class, in
 * several Swift files, which Tauri finds by selector when the page calls one
 * and which no code names. The linker takes a file of a static library only
 * for a symbol something names, so a file of commands nothing names is left
 * out of the app, and each of its commands answers "No command … found for
 * plugin vault-picker" only when it is used. It happened: SystemBridge.swift
 * had come in by chance, for a type's metadata the plugin's class used, until
 * a new file took that metadata, and the iPad's build lost sharing, printing,
 * opening a link, copying, coordinated access and background tasks with every
 * check green. The plugin's class now names each such file's own symbols
 * (VaultPickerPlugin.swift); this holds the build to it: every command the
 * sources declare is a selector in the app's executable. scripts/ipad-sim.mjs
 * checks its build, and scripts/release-ios.mjs its archive.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The plugin's Swift sources, from the repository's root. */
export const PLUGIN_SOURCES = "src-tauri/plugins/vault-picker/ios/Sources";

/** Each command a Swift source declares, `@objc public func name(_ invoke: Invoke)`, outside comments. */
export function commandsIn(swift) {
  const code = swift.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return [...code.matchAll(/@objc\s+public\s+func\s+(\w+)\s*\(\s*_\s+\w+\s*:\s*Invoke\s*\)/g)].map(
    (m) => m[1],
  );
}

/** The plugin's commands, by name, from its sources under `root`. */
export function pluginCommands(root) {
  const dir = join(root, PLUGIN_SOURCES);
  const names = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".swift"))) {
    for (const name of commandsIn(readFileSync(join(dir, file), "utf8"))) names.add(name);
  }
  return [...names].sort();
}

/**
 * The commands for which none of the selectors Tauri asks for
 * (`name:completionHandler:`, `name:error:` for one that throws, `name:`) is
 * among an executable's strings.
 */
export function missingCommands(commands, strings) {
  return commands.filter(
    (name) =>
      !strings.has(`${name}:completionHandler:`) &&
      !strings.has(`${name}:error:`) &&
      !strings.has(`${name}:`),
  );
}

/** The printable strings of an app's executable, each once. */
export function appStrings(app) {
  const exe = spawnSync(
    "plutil",
    ["-extract", "CFBundleExecutable", "raw", "-o", "-", join(app, "Info.plist")],
    { encoding: "utf8" },
  );
  if (exe.status !== 0) throw new Error(`no executable named in ${app}/Info.plist`);
  const found = spawnSync("strings", ["-a", join(app, exe.stdout.trim())], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (found.status !== 0) throw new Error(`strings failed on ${app}: ${found.stderr.trim()}`);
  return new Set(found.stdout.split("\n"));
}

/** The plugin's commands, by name, that the app built from `root` lacks. */
export function commandsMissingFrom(app, root) {
  return missingCommands(pluginCommands(root), appStrings(app));
}
