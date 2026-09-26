// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Homebrew cask for one release, printed (docs/engineering/release-engineering.md#REL-D8).
 *
 *   node scripts/homebrew-cask.mjs 0.9.0 <sha256 of Proscenium_0.9.0_universal.dmg>
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
 */
const [version, sha256] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !/^[0-9a-f]{64}$/.test(sha256 ?? "")) {
  console.error("usage: node scripts/homebrew-cask.mjs <x.y.z> <sha256>");
  process.exit(1);
}

process.stdout.write(`cask "proscenium" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/proscenium-app/proscenium/releases/download/v#{version}/Proscenium_#{version}_universal.dmg"
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
`);
