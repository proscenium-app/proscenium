# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Smoke's acts against the real app on this machine: the test build of this
# commit, driven through WebView2's DevTools port (scripts/smoke-webview2.mjs).
# Every act is a first launch on scratch folders; every check, axe in both
# schemes, the keys a PC presses, and the PC copy's tree held against
# scripts/aria/windows/. A failing check's picture goes to the evidence folder.
#
# A run that stops before its own summary is never silence. Smoke keeps a
# journal of where it is (scripts/smoke-journal.mjs); when node returns
# without the summary, this says where the run stopped, what its exit code
# means, and what the machine itself recorded meanwhile, as a failure. A run
# ended from outside then runs every act once more, from the start, and the
# second run's verdict is the step's, the first's stop said in the step's
# summary. Nothing else runs again: a check that fails has had its act's second
# try already, and a run its own error ended said the error, which a second
# run would meet again.
#
#   pwsh -NoProfile -File scripts/windows/smoke.ps1 [-Evidence windows-evidence]
#   pwsh -NoProfile -File scripts/windows/smoke.ps1 -Unsaid
#       for a later step: where smoke stopped, when this script was ended
#       with it and could not say

param([string]$Evidence = "windows-evidence", [switch]$Unsaid)

$ErrorActionPreference = "Stop"

if ($Unsaid) {
  node scripts/smoke-journal.mjs said --unsaid
  exit 0
}

# GitHub's hosted machines are slower than the build hosts: every wait may take
# twice as long there, as on its hosted Macs (scripts/smoke-checks.mjs TIME_SCALE).
if ($env:GITHUB_ACTIONS -and -not $env:SMOKE_TIME_SCALE) { $env:SMOKE_TIME_SCALE = "2" }

# What the machine recorded since `$since` of the processes a run is made of:
# Windows' own reports of a process that failed, an antivirus's detections,
# the system's errors (low memory among them), and which of them still run.
function MachineAccount([datetime]$since) {
  $names = "node.exe", "pwsh.exe", "powershell.exe", "proscenium.exe", "msedgewebview2.exe", "taskkill.exe"
  $lines = New-Object System.Collections.Generic.List[string]
  function First([string]$text) { (($text -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First 1) }
  try {
    Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = $since; Id = 1000, 1001, 1002, 1026 } -ErrorAction Stop |
      Where-Object { $m = $_.Message; $names | Where-Object { $m -match [regex]::Escape($_) } } |
      Select-Object -First 8 |
      ForEach-Object { $lines.Add("the Application log, $($_.TimeCreated.ToString('HH:mm:ss')), $($_.ProviderName) $($_.Id): $(First $_.Message)") }
  } catch { }
  try {
    Get-WinEvent -FilterHashtable @{ LogName = "System"; StartTime = $since; Level = 1, 2 } -ErrorAction Stop |
      Select-Object -First 6 |
      ForEach-Object { $lines.Add("the System log, $($_.TimeCreated.ToString('HH:mm:ss')), $($_.ProviderName) $($_.Id): $(First $_.Message)") }
  } catch { }
  try {
    Get-WinEvent -FilterHashtable @{ LogName = "System"; StartTime = $since; Id = 2004 } -ErrorAction Stop |
      Select-Object -First 2 |
      ForEach-Object { $lines.Add("low memory, $($_.TimeCreated.ToString('HH:mm:ss')): $(First $_.Message)") }
  } catch { }
  try {
    Get-MpThreatDetection -ErrorAction Stop |
      Where-Object { $_.InitialDetectionTime -ge $since } |
      Select-Object -First 4 |
      ForEach-Object { $lines.Add("Defender, $($_.InitialDetectionTime.ToString('HH:mm:ss')): $($_.ProcessName) $($_.Resources -join ', ')") }
  } catch { }
  # This run's own, and no other program's: smoke's node, the test build, and
  # WebView2 for an act's profile under .smoke\webview2.
  $runs = Join-Path (Get-Location) ".smoke\webview2\"
  try {
    Get-CimInstance Win32_Process |
      Where-Object {
        $line = "$($_.CommandLine)"
        ($_.Name -eq "node.exe" -and $line -match "smoke\.mjs") -or
        ($_.Name -eq "proscenium.exe" -and "$($_.ExecutablePath)" -eq $app) -or
        ($_.Name -eq "msedgewebview2.exe" -and $line.IndexOf($runs, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
      } |
      Select-Object -First 12 |
      ForEach-Object { $lines.Add("still running: $($_.Name) $($_.ProcessId), started by $($_.ParentProcessId)") }
  } catch { }
  if ($lines.Count -eq 0) { $lines.Add("the machine recorded nothing of these processes: no failure report, detection or system error, and none of them still running") }
  Write-Host "        what the machine recorded since the run began:"
  foreach ($l in $lines) { Write-Host "          $l" }
}

node scripts/build-app.mjs --selftest
if ($LASTEXITCODE -ne 0) { throw "the test build did not build" }

$app = Join-Path (Get-Location) "src-tauri\target\release\proscenium.exe"
$stoppedFirst = $null
$ownError = $null
for ($run = 1; $run -le 2; $run++) {
  Remove-Item .smoke\journal.ndjson, .smoke\stopped.txt -Force -ErrorAction SilentlyContinue
  $since = Get-Date
  node scripts/smoke.mjs --engine webview2 --app $app --shots
  $code = $LASTEXITCODE

  $shots = Get-ChildItem .smoke -Filter *.png -ErrorAction SilentlyContinue
  if ($shots) {
    New-Item -ItemType Directory -Force $Evidence | Out-Null
    $shots | Copy-Item -Destination $Evidence
  }
  if ($code -eq 0) { break }

  # A run that said its verdict (failures listed, then "smoke: N failures")
  # has said everything: it stands.
  node scripts/smoke-journal.mjs said --exit $code
  $said = $LASTEXITCODE
  if ($said -ne 3 -and $said -ne 4) { break }
  MachineAccount $since
  New-Item -ItemType Directory -Force $Evidence | Out-Null
  Copy-Item .smoke\journal.ndjson (Join-Path $Evidence "journal-run-$run.ndjson") -ErrorAction SilentlyContinue
  $where = (Get-Content .smoke\stopped.txt -Encoding utf8 -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($said -eq 4) { $ownError = $where; break }
  if ($run -eq 1) {
    $stoppedFirst = $where
    Write-Host ""
    Write-Host "  smoke stopped before its summary: every act once more, from the start; the second run's verdict is this step's"
    Write-Host ""
  }
}

if ($env:GITHUB_STEP_SUMMARY) {
  $verdict = if ($code -eq 0) { "clean" } else { "failed" }
  if ($stoppedFirst) { $verdict += " in a second run, after the first stopped before its summary $stoppedFirst" }
  if ($ownError) { $verdict += ": smoke stopped on an error of its own $ownError" }
  "- Smoke's acts in the real app: $verdict" | Out-File -Append -Encoding utf8 $env:GITHUB_STEP_SUMMARY
}
exit $code
