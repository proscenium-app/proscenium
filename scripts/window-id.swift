// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//  The CGWindowID of an app's main window, for `screencapture -l <id>`.
//
//  There is no built-in CLI for this, and it is the only way to look at a
//  native window from a script: tauri-driver is Linux/Windows only, so a Tauri
//  app on macOS cannot be driven by WebDriver at all. Prints the largest
//  on-screen window, which is the document window rather than a helper.
//
//      swift scripts/window-id.swift Proscenium
import CoreGraphics
import Foundation

let wanted = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Proscenium"
guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
  as? [[String: Any]]
else { exit(1) }

var best: (id: Int, area: Double) = (0, 0)
for w in list {
  guard (w[kCGWindowOwnerName as String] as? String ?? "").contains(wanted) else { continue }
  guard (w[kCGWindowLayer as String] as? Int ?? -1) == 0 else { continue }
  let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
  let area = (b["Width"] ?? 0) * (b["Height"] ?? 0)
  if area > best.area { best = (w[kCGWindowNumber as String] as? Int ?? 0, area) }
}
if best.id == 0 {
  FileHandle.standardError.write("no on-screen window for \(wanted)\n".data(using: .utf8)!)
  exit(1)
}
print(best.id)
