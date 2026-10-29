# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The current Evergreen WebView2 on this machine, and its version recorded.
#
# GitHub's Windows images carry the WebView2 they were built with and never
# update it, while a writer's copy runs on the Evergreen runtime, which updates
# itself and gains a new major version every few weeks. So a run tests on the
# runtime writers have: it asks Microsoft's own update service which version
# Edge's Stable channel is on, installs Microsoft's standalone Evergreen
# installer for this machine's chip when the machine is behind (signed by
# Microsoft, or refused), and fails if the runtime is still older afterwards.
#
# The version goes in the run's summary and in the step's `version` output, so a
# fault that arrives with a new runtime names the runtime, not a commit.
#
#   pwsh -NoProfile -File scripts/windows/webview2.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# WebView2's client id with Microsoft's updater.
$Client = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$Standalone = @{
  "x64"   = "https://go.microsoft.com/fwlink/?linkid=2124701"
  "arm64" = "https://go.microsoft.com/fwlink/?linkid=2099616"
}

function Say([string]$line) {
  Write-Host $line
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $line -Encoding UTF8 }
}

function Fail([string]$why) {
  Write-Host "::error::$why"
  exit 1
}

function HostChip {
  $arch = $env:PROCESSOR_ARCHITEW6432
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
  if ($arch -eq "ARM64") { return "arm64" }
  if ($arch -eq "AMD64") { return "x64" }
  Fail "an unexpected processor architecture: $arch"
}

# The installed runtime's version, machine-wide first, then this user's; $null
# when there is none.
function Installed {
  foreach ($key in @(
      "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$Client",
      "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$Client",
      "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$Client")) {
    $pv = (Get-ItemProperty -Path $key -Name pv -ErrorAction SilentlyContinue).pv
    if ($pv -and $pv -ne "0.0.0.0") { return [version]$pv }
  }
  return $null
}

# Edge's Stable channel for Windows on this chip, as Microsoft's update service
# lists it; $null when the service cannot be read, which is said and not failed:
# the runtime is still installed and recorded.
function Stable([string]$chip) {
  try {
    $products = Invoke-RestMethod -Uri "https://edgeupdates.microsoft.com/api/products" -TimeoutSec 30
    $release = $products | Where-Object { $_.Product -eq "Stable" } |
      ForEach-Object { $_.Releases } |
      Where-Object { $_.Platform -eq "Windows" -and $_.Architecture -eq $chip } |
      Sort-Object { [version]$_.ProductVersion } -Descending | Select-Object -First 1
    if ($release) { return [version]$release.ProductVersion }
  } catch {
    Write-Host "::warning::Edge's release list could not be read: $($_.Exception.Message)"
  }
  return $null
}

$chip = HostChip
$before = Installed
$stable = Stable $chip

if (-not $before -or -not $stable -or $before -lt $stable) {
  $installer = Join-Path $env:RUNNER_TEMP "MicrosoftEdgeWebView2RuntimeInstaller-$chip.exe"
  Invoke-WebRequest -Uri $Standalone[$chip] -OutFile $installer
  $sig = Get-AuthenticodeSignature $installer
  if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
    Fail "the WebView2 installer is not signed by Microsoft ($($sig.Status), $($sig.SignerCertificate.Subject))"
  }
  $p = Start-Process -FilePath $installer -ArgumentList "/silent", "/install" -Wait -PassThru
  Write-Host "the standalone installer exited $($p.ExitCode)"
}

$after = Installed
if (-not $after) { Fail "no WebView2 runtime is installed" }
$was = if ($before) { "$before" } else { "none" }
$channel = if ($stable) { "$stable" } else { "unknown" }
Say "- WebView2: $after (the image had $was; Edge Stable for Windows $chip is $channel)"
if ($env:GITHUB_OUTPUT) { Add-Content -Path $env:GITHUB_OUTPUT -Value "version=$after" -Encoding UTF8 }
# The runtime's own build can trail Edge's by a patch for a day; a major
# version behind is a machine that did not update.
if ($stable -and $after.Major -lt $stable.Major) {
  Fail "WebView2 is $after after the install, a major version behind Edge Stable's $stable"
}
if ($stable -and $after -lt $stable) {
  Write-Host "::warning::WebView2 $after trails Edge Stable's $stable within the same major version"
}
