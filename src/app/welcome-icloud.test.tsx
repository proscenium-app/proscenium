// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Welcome screen's first door on an iPad, whose record suggests the app's
 * own iCloud container as a Mac's does
 * (docs/engineering/cross-platform.md#PLAT-8): offered first where the
 * container is there, in the iPad's words, and not at all where there is none
 * (no iCloud account, iCloud Drive off, the app turned off in it), where the
 * screen says nothing of iCloud but as one of the places the picker reaches.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { setSystemWords, type SystemWords } from "../ui/system-words";
import { WelcomeScreen } from "./WelcomeScreen";

/** As src-tauri/src/lib.rs `capabilities` answers on an iPad, and on a Mac. */
const IPAD: SystemWords = {
  machine: "iPad",
  system: "iPadOS",
  fileManager: "Files",
  trash: "Proscenium’s Trash",
};
const MAC: SystemWords = { machine: "Mac", system: "macOS", fileManager: "Finder", trash: "Trash" };

const nothing = () => {};
/** The doors, by name, in the order the screen offers them. */
function doors(cloudRoot: string | null): string[] {
  const html = renderToStaticMarkup(
    <WelcomeScreen
      cloudRoot={cloudRoot}
      suggestedFolder="icloud"
      lastVault={null}
      onChooseCloud={nothing}
      onChooseDocuments={nothing}
      onChooseFolder={nothing}
      onReopenLast={nothing}
      privacyNotice={false}
      onPrivacyNoticeSeen={nothing}
      onPrivacySettings={nothing}
    />,
  );
  return [
    ...html.matchAll(
      /class="welcome__choiceName">([^<]*)<\/span><span class="welcome__choiceNote">([^<]*)</g,
    ),
  ].map((m) => `${m[1]}: ${m[2]}`);
}

const CONTAINER =
  "/private/var/mobile/Library/Mobile Documents/iCloud~org~habiby~proscenium/Documents";

afterEach(() => setSystemWords(MAC));

describe("the Welcome screen on an iPad", () => {
  test("offers the app's iCloud container first where it is there", () => {
    setSystemWords(IPAD);
    expect(doors(CONTAINER)).toEqual([
      "iCloud Drive: Recommended — your plays appear on your other devices too.",
      "A folder I choose…: iCloud Drive, On My iPad, or another place in Files.",
    ]);
  });

  test("offers no iCloud door where there is no container", () => {
    setSystemWords(IPAD);
    expect(doors(null)).toEqual([
      "A folder I choose…: iCloud Drive, On My iPad, or another place in Files.",
    ]);
  });
});
