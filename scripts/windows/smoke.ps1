# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Smoke's acts against the real app on this machine: the test build of this
# commit, driven through WebView2's DevTools port (scripts/smoke-webview2.mjs).
# Every act is a first launch on scratch folders; every check, axe in both
# schemes, the keys a PC presses, and the PC copy's tree held against
# scripts/aria/windows/. A failing check's picture goes to the evidence folder.
#
#   pwsh -NoProfile -File scripts/windows/smoke.ps1 [-Evidence windows-evidence]

param([string]$Evidence = "windows-evidence")

$ErrorActionPreference = "Stop"

# GitHub's hosted machines are slower than the build hosts: every wait may take
# twice as long there, as on its hosted Macs (scripts/smoke-checks.mjs TIME_SCALE).
if ($env:GITHUB_ACTIONS -and -not $env:SMOKE_TIME_SCALE) { $env:SMOKE_TIME_SCALE = "2" }

node scripts/build-app.mjs --selftest
if ($LASTEXITCODE -ne 0) { throw "the test build did not build" }

$app = Join-Path (Get-Location) "src-tauri\target\release\proscenium.exe"
node scripts/smoke.mjs --engine webview2 --app $app --shots
$code = $LASTEXITCODE

$shots = Get-ChildItem .smoke -Filter *.png -ErrorAction SilentlyContinue
if ($shots) {
  New-Item -ItemType Directory -Force $Evidence | Out-Null
  $shots | Copy-Item -Destination $Evidence
}
if ($env:GITHUB_STEP_SUMMARY) {
  $verdict = if ($code -eq 0) { "clean" } else { "failed" }
  "- Smoke's acts in the real app: $verdict" | Out-File -Append -Encoding utf8 $env:GITHUB_STEP_SUMMARY
}
exit $code
