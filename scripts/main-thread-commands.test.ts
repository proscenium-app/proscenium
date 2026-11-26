// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Tauri runs a command that is not async on the main thread, and on an iPad
 * the folder-picker plugin's UIKit commands (the pasteboard, the share sheet,
 * the print panel, a link, a background task, the folder picker) answer from
 * the main thread. A command run there that asked one waited on itself, and
 * the app answered nothing again: Send Feedback's Copy Message did so on an
 * iPad (docs/engineering/cross-platform.md#PLAT-76). So no command that is
 * not async reaches the plugin, or the app's wrappers of those calls, itself.
 * What it calls in turn is not read: this holds the step everyone takes.
 */

const SRC = join(import.meta.dir, "..", "src-tauri", "src");

/** The calls that reach a plugin command answered from the main thread. */
const MAIN_THREAD_CALLS = [
  "vault_picker()",
  "copy_text(",
  "copy_to_clipboard(",
  "share_file(",
  "print_file(",
  "open_url(",
  "begin_background_task(",
  "end_background_task(",
  "pick_folder(",
];

function rustFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return rustFiles(path);
    return name.endsWith(".rs") ? [path] : [];
  });
}

interface Command {
  file: string;
  name: string;
  async: boolean;
  body: string;
}

/** Every `#[tauri::command]` in a file: its name, whether it is async, and its body. */
export function commandsIn(file: string, source: string): Command[] {
  const out: Command[] = [];
  const attr = /#\[tauri::command(\([^)]*\))?\]/g;
  for (let m = attr.exec(source); m; m = attr.exec(source)) {
    const sig = /(pub(\([a-z]+\))?\s+)?(async\s+)?fn\s+([a-z_0-9]+)/.exec(source.slice(m.index));
    if (!sig) continue;
    const open = source.indexOf("{", m.index + (sig.index ?? 0));
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}" && --depth === 0) break;
    }
    out.push({
      file,
      name: sig[4] as string,
      async: !!sig[3] || /async/.test(m[1] ?? ""),
      body: source.slice(open, end + 1),
    });
  }
  return out;
}

describe("a command run on the main thread never waits on it", () => {
  const commands = rustFiles(SRC).flatMap((file) => commandsIn(file, readFileSync(file, "utf8")));

  test("the commands are read", () => {
    expect(commands.length).toBeGreaterThan(50);
    expect(commands.find((c) => c.name === "diagnostics_copy")?.async).toBe(true);
  });

  test("no command that is not async calls the plugin's main-thread commands itself", () => {
    const waits = commands
      .filter((c) => !c.async)
      .flatMap((c) =>
        MAIN_THREAD_CALLS.filter((call) => c.body.includes(call)).map(
          (call) => `${c.file.slice(SRC.length + 1)} ${c.name} calls ${call}`,
        ),
      );
    expect(waits).toEqual([]);
  });

  test("the reader tells an async command from one that is not, and finds its body", () => {
    const found = commandsIn(
      "t.rs",
      '#[tauri::command]\npub fn a(x: u8) -> u8 { if x > 0 { copy_text("") } x }\n#[tauri::command]\npub async fn b() { vault_picker() }\n#[tauri::command(async)]\nfn c() {}',
    );
    expect(found.map((c) => [c.name, c.async, c.body.includes("copy_text(")])).toEqual([
      ["a", false, true],
      ["b", true, false],
      ["c", true, false],
    ]);
  });
});
