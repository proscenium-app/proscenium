// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { commandsIn, missingCommands, pluginCommands } from "./plugin-commands.mjs";

describe("the folder-picker plugin's commands", () => {
  test("a command is an @objc public func that takes an Invoke", () => {
    const swift = `
extension VaultPickerPlugin {
  @objc public func shareFile(_ invoke: Invoke) throws {}
  @objc public func copyText(_ invoke: Invoke) {}
  @objc public  func   spaced( _ call : Invoke ) throws {}
  @objc func prosceniumMenuItem(_ sender: UICommand) {}
  public func helper(_ invoke: Invoke) {}
  // @objc public func commented(_ invoke: Invoke)
  /* @objc public func blocked(_ invoke: Invoke) */
}`;
    expect(commandsIn(swift)).toEqual(["shareFile", "copyText", "spaced"]);
  });

  test("the sources declare the commands Rust and the page call", () => {
    const names = pluginCommands(join(import.meta.dir, "../.."));
    for (const name of [
      "pickFolder",
      "shareFile",
      "beginCoordinated",
      "endCoordinated",
      "cloudContainer",
    ]) {
      expect(names).toContain(name);
    }
  });

  test("a command is in a build when any selector Tauri asks for is", () => {
    const strings = new Set([
      "shareFile:error:",
      "copyText:",
      "load:completionHandler:",
      "pickFolder",
    ]);
    expect(
      missingCommands(["shareFile", "copyText", "load", "pickFolder", "openUrl"], strings),
    ).toEqual(["pickFolder", "openUrl"]);
  });
});
