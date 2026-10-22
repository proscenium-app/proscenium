# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The Windows build's tools on one of GitHub's hosted Windows machines, each
# put on the job's PATH and recorded in the run's summary, so a run that fails
# says which tool it had:
#
#   -Rust     rustup (installed if the image has none), the channel
#             rust-toolchain.toml pins, and the standard library of -Target
#   -Clang    a clang on PATH: ring builds its assembly for Windows on Arm with
#             clang, and MSVC alone cannot ("failed to find tool clang")
#   -Winapp   Microsoft's winapp command-line tool, which makes the Store's
#             MSIX package: a pinned release, held to its published hash
#
# PowerShell 7, which leaves a native tool's progress on stderr as text: Windows
# PowerShell 5.1 turns it into errors when a runner redirects it. ASCII only.
#
#   pwsh -NoProfile -File scripts/windows/tools.ps1 -Rust -Clang -Target aarch64-pc-windows-msvc

param(
  [switch]$Rust,
  [switch]$Clang,
  [switch]$Winapp,
  [string]$Target = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# winapp 0.7.1 (2026-10-01), the zips' SHA-256 as GitHub's release lists them.
$WinappVersion = "v0.7.1"
$WinappZips = @{
  "x64"   = "d925d1e32cdc320b6d271f653fd2cd3c05b5d7558deb20d1b548bead77900fcf"
  "arm64" = "4ed1edcc6d4a1a7c75bb70dbdbf77a69b3c650823c7e8061aa66f8adb1017f2e"
}

function Say([string]$line) {
  Write-Host $line
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $line -Encoding UTF8 }
}

function OnPath([string]$dir) {
  $env:PATH = "$dir;$env:PATH"
  if ($env:GITHUB_PATH) { Add-Content -Path $env:GITHUB_PATH -Value $dir -Encoding UTF8 }
}

function Fail([string]$why) {
  Write-Host "::error::$why"
  exit 1
}

# The machine's own chip, not this process's: a 32-bit or emulated shell would
# otherwise name the wrong one.
function HostChip {
  $arch = $env:PROCESSOR_ARCHITEW6432
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
  switch ($arch) {
    "ARM64" { return "arm64" }
    "AMD64" { return "x64" }
    default { Fail "an unexpected processor architecture: $arch" }
  }
}

$chip = HostChip

if ($Rust) {
  $rustup = Get-Command rustup -ErrorAction SilentlyContinue
  if (-not $rustup) {
    $triple = if ($chip -eq "arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
    $init = Join-Path $env:RUNNER_TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/$triple/rustup-init.exe" -OutFile $init
    $sig = Get-AuthenticodeSignature $init
    if ($sig.Status -ne "Valid") { Fail "rustup-init.exe is not validly signed ($($sig.Status))" }
    & $init -y --default-toolchain none --profile minimal --no-modify-path
    if ($LASTEXITCODE -ne 0) { Fail "rustup-init exited $LASTEXITCODE" }
    OnPath (Join-Path $env:USERPROFILE ".cargo\bin")
  }
  # rust-toolchain.toml names the channel, its components and targets.
  rustup toolchain install
  if ($LASTEXITCODE -ne 0) { Fail "rustup toolchain install exited $LASTEXITCODE" }
  if ($Target) {
    rustup target add $Target
    if ($LASTEXITCODE -ne 0) { Fail "rustup target add $Target exited $LASTEXITCODE" }
  }
  Say ("- Rust: " + ((rustc --version) -join " ") + ", host " + ((rustc -vV | Select-String '^host:').ToString() -replace '^host:\s*', ''))
}

if ($Clang) {
  $found = Get-Command clang -ErrorAction SilentlyContinue
  $dir = $null
  if ($found) {
    $dir = Split-Path $found.Source
  } else {
    $candidates = @("C:\Program Files\LLVM\bin")
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
      foreach ($vs in (& $vswhere -all -products * -property installationPath)) {
        $llvm = if ($chip -eq "arm64") { "VC\Tools\Llvm\ARM64\bin" } else { "VC\Tools\Llvm\x64\bin" }
        $candidates += (Join-Path $vs $llvm)
      }
    }
    foreach ($c in $candidates) {
      if (Test-Path (Join-Path $c "clang.exe")) { $dir = $c; break }
    }
    if (-not $dir) { Fail "no clang on this machine: looked on PATH and in $($candidates -join ', ')" }
    OnPath $dir
  }
  $version = (& (Join-Path $dir "clang.exe") --version | Select-Object -First 1)
  Say "- clang: $version, from $dir"
}

if ($Winapp) {
  $zip = Join-Path $env:RUNNER_TEMP "winappcli-$chip.zip"
  $url = "https://github.com/microsoft/winappCli/releases/download/$WinappVersion/winappcli-$chip.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip
  $hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
  if ($hash -ne $WinappZips[$chip]) { Fail "winappcli-$chip.zip $WinappVersion hashes to $hash, not $($WinappZips[$chip])" }
  $dir = Join-Path $env:RUNNER_TEMP "winapp"
  Expand-Archive -Path $zip -DestinationPath $dir -Force
  $exe = Get-ChildItem -Path $dir -Recurse -Filter winapp.exe | Select-Object -First 1
  if (-not $exe) { Fail "winappcli-$chip.zip holds no winapp.exe" }
  OnPath $exe.DirectoryName
  # Nothing this build does is Microsoft's to count.
  $env:WINAPP_CLI_TELEMETRY_OPTOUT = "1"
  if ($env:GITHUB_ENV) { Add-Content -Path $env:GITHUB_ENV -Value "WINAPP_CLI_TELEMETRY_OPTOUT=1" -Encoding UTF8 }
  $v = (& $exe.FullName --version | Select-Object -First 1)
  Say "- winapp: $v ($WinappVersion, $chip)"
}
