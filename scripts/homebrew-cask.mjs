// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Homebrew cask for one release, printed (docs/engineering/release-engineering.md#REL-D8).
 *
 *   node scripts/homebrew-cask.mjs 0.9.0 <sha256 of Proscenium_0.9.0_universal.dmg>
 *   node scripts/homebrew-cask.mjs 0.9.0 --sha256 <sha256> --url <address of the DMG>
 *
 * The cask lives in a personal tap, proscenium-app/homebrew-tap, until the
 * repository qualifies for homebrew/cask (30 days old and 75 stars), and
 * .github/workflows/homebrew.yml writes it there when a release is published.
 * The template lives here, beside the app, so a change to what the app installs
 * or leaves behind is reviewed with the change that caused it.
 *
 *   brew install --cask proscenium-app/tap/proscenium
 *
 * The full name trusts that one cask: Homebrew 6 asks a person to trust a
 * third-party tap before it installs from it.
 *
 * `--url` points the cask at a DMG somewhere other than the release's page on
 * GitHub: an `https://` address, or a `file:///` one for a rehearsal of the
 * install from a local tap, where the DMG is the one a release build made on
 * the same Mac. Without it the cask names the release's own DMG, by version.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The release's DMG on GitHub, as the cask says it: Homebrew fills in the version. */
export const RELEASE_URL =
  "https://github.com/proscenium-app/proscenium/releases/download/v#{version}/Proscenium_#{version}_universal.dmg";

const VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** An address Ruby's string and Homebrew's download both take as written: no quote, no `#{`, no space. */
const ADDRESS = /^(?:https:\/\/[A-Za-z0-9.-]+|file:\/\/)\/[A-Za-z0-9._~%+=,@:/-]*$/;
const USAGE =
  "usage: node scripts/homebrew-cask.mjs <x.y.z> <sha256>\n       node scripts/homebrew-cask.mjs <x.y.z> --sha256 <sha256> [--url <https:// or file:/// address of the DMG>]";

/** The cask's text. Throws on a version, hash or address it would not write. */
export function cask({ version, sha256, url = RELEASE_URL }) {
  if (!VERSION.test(version ?? "")) throw new Error(`${version} is not a version, x.y.z`);
  if (!SHA256.test(sha256 ?? "")) throw new Error("the SHA-256 is 64 lowercase hex digits");
  if (url !== RELEASE_URL && !ADDRESS.test(url))
    throw new Error(`${url} is not an https:// or file:/// address the cask can name`);
  return `cask "proscenium" do
  version "${version}"
  sha256 "${sha256}"

  url "${url}"
  name "Proscenium"
  desc "Write stage plays in industry-standard format"
  homepage "https://proscenium.ink/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app updates itself, so \`brew upgrade\` leaves it to do so.
  auto_updates true
  depends_on macos: :sonoma

  app "Proscenium.app"

  # What the app keeps beside itself: preferences, version history, the debug
  # log, WebKit's own storage. Never the Plays folder, and never the iCloud
  # Drive container (~/Library/Mobile Documents/iCloud~org~habiby~proscenium):
  # those hold the writer's plays.
  zap trash: [
    "~/Library/Application Support/org.habiby.proscenium",
    "~/Library/Caches/org.habiby.proscenium",
    "~/Library/HTTPStorages/org.habiby.proscenium",
    "~/Library/Preferences/org.habiby.proscenium.plist",
    "~/Library/Saved Application State/org.habiby.proscenium.savedState",
    "~/Library/WebKit/org.habiby.proscenium",
  ]
end
`;
}

/** What a command line asks for: `<version> <sha256>`, or `<version> --sha256 <sha256> [--url <url>]`. */
export function caskOptions(argv) {
  const [version, ...rest] = argv;
  if (rest.length === 1 && !rest[0].startsWith("--")) return { version, sha256: rest[0] };
  const options = { version };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!["--sha256", "--url"].includes(flag) || value === undefined || flag.slice(2) in options)
      throw new Error(USAGE);
    options[flag.slice(2)] = value;
  }
  if (!options.sha256) throw new Error(USAGE);
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(cask(caskOptions(process.argv.slice(2))));
  } catch (error) {
    console.error(
      error.message.startsWith("usage:") ? error.message : `${error.message}\n${USAGE}`,
    );
    process.exit(1);
  }
}
