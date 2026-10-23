# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The installed-artifact proof: each Windows package, exactly as built, put
# through what a writer's PC does with it, on a clean hosted Windows machine.
# No hook in the release build is used; everything is seen from outside.
#
# The installer (Proscenium_<version>_<chip>-setup.exe):
#   1. given the mark of the web, as a browser leaves a download;
#   2. asks for no administrator: its manifest runs it as the user who starts it;
#   3. installed for the current user, silently (/S), in the default place;
#      what it installs carries no mark, so the app itself meets no warning;
#   4. started from its Start menu entry, with update checks and reports
#      switched off in its settings first, so the proof asks nothing of a
#      production service;
#   5. found by UI Automation from outside: its window titled, and its first
#      screen in the tree, as the accessibility snapshot of that screen names it;
#   6. closed through its window, and exits 0 within ten seconds;
#   7. uninstalled silently: no folder, Start menu entry, desktop shortcut,
#      uninstall entry or file type left. What the writer made is kept, as the
#      uninstaller keeps it unless its box is ticked: the app's data folders
#      and the remembered install location;
#   8. installed again, and uninstalled as a writer does it from Settings, with
#      "Delete the application data" ticked: nothing at all is left.
# The Store's package (an MSIX signed for this machine alone):
#   1. given the mark of the web; its throwaway certificate trusted here;
#   2. installed for the current user (Add-AppxPackage);
#   3. started from its Start menu entry, with the same settings seeded in the
#      package's own store, where a packaged app's new data lands;
#   4. found, read and closed as above, its data kept inside that store;
#   5. removed: no package, Start menu entry or app data left, and nothing ever
#      written to the real AppData; the certificate taken back out. Windows'
#      package manager leaves each file type's key behind, empty, which no
#      package can prevent; any value in one fails the proof.
#
# Pictures are taken of a failing step only, into <Evidence>/pictures.
#
# Windows PowerShell 5.1, which has UI Automation's managed client and the Appx
# cmdlets built in; ASCII only, since it reads a file without a byte-order mark
# in the machine's own code page.
#
# What it installs is what scripts/windows/release-build.mjs left: the
# installer in -Files, and in -Proof the test-signed package, its certificate
# and the package's name.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/installed-proof.ps1 `
#     [-Files windows-files] [-Proof windows-proof] [-Evidence windows-evidence]

param(
  [string]$Files = "windows-files",
  [string]$Proof = "windows-proof",
  [string]$Evidence = "windows-evidence"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function One([string]$dir, [string]$pattern) {
  $found = @(Get-ChildItem -Path $dir -Filter $pattern -File -ErrorAction SilentlyContinue)
  if ($found.Count -ne 1) { throw "$dir holds $($found.Count) files matching $pattern, not one" }
  return $found[0].FullName
}
$Installer = One $Files "*-setup.exe"
$Msix = One $Proof "*.test.msix"
$Cer = One $Proof "throwaway.cer"
$PackageName = (Get-Content -Raw (One $Proof "package-name.txt")).Trim()

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$Conf = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "src-tauri/tauri.conf.json") | ConvertFrom-Json
$Product = $Conf.productName
$BundleId = $Conf.identifier
# Tauri's installer files the install location under the publisher, which it
# takes from the identifier's second part when the config names none.
$Maker = $BundleId.Split(".")[1]
$Title = $Conf.app.windows[0].title
$AppExe = "proscenium"

New-Item -ItemType Directory -Force -Path (Join-Path $Evidence "pictures") | Out-Null
$Log = Join-Path $Evidence "proof.log"
$Results = New-Object System.Collections.Generic.List[string]
$script:LastNames = @()

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# The uninstaller's own dialog, as Windows' controls: its box is made by the
# page with CreateWindowEx, and UI Automation's reading of it is not to be
# relied on, so the box and the buttons are found and pressed as Win32 knows them.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace ProofNative {
  public static class Win32 {
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    public static string Text(IntPtr hWnd) {
      var text = new StringBuilder(512);
      GetWindowText(hWnd, text, text.Capacity);
      return text.ToString();
    }
    // The first visible check box under a window, at any depth.
    public static IntPtr CheckBox(IntPtr top) {
      IntPtr found = IntPtr.Zero;
      EnumChildWindows(top, (h, l) => {
        var cls = new StringBuilder(64);
        GetClassName(h, cls, cls.Capacity);
        long kind = GetWindowLongPtr(h, -16).ToInt64() & 0xF;
        if (string.Equals(cls.ToString(), "Button", StringComparison.OrdinalIgnoreCase) && (kind == 2 || kind == 3) && IsWindowVisible(h)) {
          found = h;
          return false;
        }
        return true;
      }, IntPtr.Zero);
      return found;
    }
  }
}
"@
$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

function Note([string]$line) {
  Write-Host $line
  Add-Content -Path $Log -Value $line -Encoding UTF8
}

function Summary([string]$line) {
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $line -Encoding UTF8 }
}

function Picture([string]$name) {
  try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $file = Join-Path $Evidence ("pictures/" + ($name -replace '[^A-Za-z0-9._-]', '-') + ".png")
    $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bitmap.Dispose()
    Note "    picture: $file"
  } catch {
    Note "    no picture: $($_.Exception.Message)"
  }
}

function Finish([int]$code) {
  Summary ""
  foreach ($r in $Results) { Summary $r }
  exit $code
}

# One step of the proof: it passes, or the proof stops there with a picture.
function Step([string]$name, [scriptblock]$body) {
  Note "- $name"
  try {
    $said = & $body
    if ($said) { Note "    $said" }
    $tail = ""
    if ($said) { $tail = " ($said)" }
    $Results.Add("- pass: $name$tail")
  } catch {
    $why = $_.Exception.Message
    Note "    FAILED: $why"
    Picture $name
    $Results.Add("- **FAILED: $name**: $why")
    Finish 1
  }
}

function Until([int]$seconds, [scriptblock]$test) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    $value = & $test
    if ($value) { return $value }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Elevated {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- what the first screen says, from its accessibility snapshot --------------

# The PC copy's snapshot when there is one, else the page's own: the heading,
# and every button, matched up to an ellipsis, since what follows one (the
# places a folder can be) is the part a platform words its own way.
function Expected {
  $file = Join-Path $Root "scripts/aria/windows/welcome.yml"
  if (-not (Test-Path $file)) { $file = Join-Path $Root "scripts/aria/welcome.yml" }
  $text = Get-Content -Raw -Encoding UTF8 $file
  $heading = [regex]::Match($text, 'heading "((?:[^"\\]|\\.)*)" \[level=1\]')
  if (-not $heading.Success) { throw "$file names no level-1 heading" }
  $buttons = foreach ($m in [regex]::Matches($text, 'button "((?:[^"\\]|\\.)*)"')) {
    (($m.Groups[1].Value -replace '\\"', '"') -split [char]0x2026)[0].Trim()
  }
  return @{ File = $file; Heading = ($heading.Groups[1].Value -replace '\\"', '"'); Buttons = @($buttons) }
}

$Screen = Expected

function Squash([string]$s) { return ($s -replace '\s+', ' ').Trim() }

# --- UI Automation -------------------------------------------------------------

function TopWindow([int]$processId, [string]$name) {
  $cond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $processId)),
    (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $CT::Window)))
  foreach ($w in $A::RootElement.FindAll($TS::Children, $cond)) {
    if ($w.Current.Name -eq $name) { return $w }
  }
  return $null
}

function Descendants($element, $controlType) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $controlType)
  return @($element.FindAll($TS::Descendants, $cond))
}

[System.Windows.Automation.Condition[]]$readableTypes = @($CT::Text, $CT::Button, $CT::Hyperlink, $CT::Group, $CT::Document) |
  ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $_) }
$Readable = [System.Windows.Automation.OrCondition]::new($readableTypes)

# The first screen read out of the window, as UI Automation gives it to any
# reader outside the app; WebView2 builds that tree when one first asks.
function ReadFirstScreen($window) {
  $seen = Until 60 {
    $names = @()
    foreach ($e in $window.FindAll($TS::Descendants, $Readable)) {
      $names += New-Object PSObject -Property @{
        Button = ($e.Current.ControlType -eq $CT::Button)
        Type   = $e.Current.LocalizedControlType
        Name   = (Squash $e.Current.Name)
      }
    }
    $script:LastNames = $names
    $heading = $names | Where-Object { $_.Name -eq (Squash $Screen.Heading) } | Select-Object -First 1
    $missing = @($Screen.Buttons | Where-Object {
        $want = Squash $_
        -not ($names | Where-Object { $_.Button -and $_.Name.StartsWith($want) })
      })
    if ($heading -and $missing.Count -eq 0) { return , $names }
    return $null
  }
  if (-not $seen) {
    foreach ($n in ($script:LastNames | Select-Object -First 60)) { Note "      seen: [$($n.Type)] $($n.Name)" }
    throw "the window's tree never showed the heading `"$($Screen.Heading)`" and the buttons $($Screen.Buttons -join ' / ')"
  }
  $h = $seen | Where-Object { $_.Name -eq (Squash $Screen.Heading) } | Select-Object -First 1
  return "[$($h.Type)] `"$($h.Name)`" and $($Screen.Buttons.Count) buttons"
}

function WebViewsOf([string]$needle) {
  return @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) })
}

function CloseThroughWindow($window, $process) {
  $pattern = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
  $pattern.Close()
  if (-not $process.WaitForExit(10000)) { throw "the app was still running ten seconds after its window was closed" }
  if ($process.ExitCode -ne 0) { throw "the app exited $($process.ExitCode)" }
  # WebView2's own processes outlive the app by a moment; nothing is judged
  # while they still hold the app's data.
  Until 30 { (WebViewsOf $BundleId).Count -eq 0 } | Out-Null
  return "exit 0"
}

# The app's process, found by the executable it runs, and held open so its
# exit code can still be read once it has gone. The path comes from the system
# (WMI), not from the process's own module list, which a reader of another
# architecture cannot read.
function AppProcess([string]$path) {
  $want = [System.IO.Path]::GetFullPath($path)
  $found = Until 60 {
    Get-CimInstance Win32_Process -Filter "Name = '$AppExe.exe'" |
      Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq $want } |
      Select-Object -First 1
  }
  if (-not $found) {
    $running = @(Get-CimInstance Win32_Process -Filter "Name = '$AppExe.exe'" | ForEach-Object { "$($_.ProcessId) $($_.ExecutablePath)" })
    throw "no $path started (running: $(if ($running.Count) { $running -join '; ' } else { 'none' }))"
  }
  $process = Get-Process -Id $found.ProcessId
  $null = $process.Handle
  return $process
}

# --- what is on the machine ----------------------------------------------------

# Every key and value under HKCU\Software\Classes (but Windows' own shell
# caches in Local Settings), the app's uninstall entry, and its publisher's key.
function Registry {
  $lines = New-Object System.Collections.Generic.List[string]
  function Walk($key, [string]$path) {
    if ($path -match '^HKCU\\Software\\Classes\\Local Settings') { return }
    foreach ($v in $key.GetValueNames()) {
      $data = $key.GetValue($v, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $lines.Add("$path | $v = $(($data | ForEach-Object { "$_" }) -join ',')")
    }
    $lines.Add("$path\")
    foreach ($sub in $key.GetSubKeyNames()) {
      $child = $key.OpenSubKey($sub)
      if ($child) {
        Walk $child "$path\$sub"
        $child.Close()
      }
    }
  }
  foreach ($p in @(
      "Software\Classes",
      "Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product",
      "Software\$Maker")) {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($p)
    if ($k) {
      Walk $k "HKCU\$p"
      $k.Close()
    }
  }
  return $lines
}

function Places {
  return [ordered]@{
    "install folder"     = (Join-Path $env:LOCALAPPDATA $Product)
    "Start menu entry"   = (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$Product.lnk")
    "desktop shortcut"   = (Join-Path ([Environment]::GetFolderPath("Desktop")) "$Product.lnk")
    "app data (roaming)" = (Join-Path $env:APPDATA $BundleId)
    "app data (local)"   = (Join-Path $env:LOCALAPPDATA $BundleId)
  }
}

function Snapshot {
  $here = @{}
  foreach ($kv in (Places).GetEnumerator()) { $here[$kv.Key] = Test-Path $kv.Value }
  return @{ Places = $here; Registry = @(Registry) }
}

# What is on the machine now and was not before, or is gone that was, less
# what the caller expects left behind.
function LeftBehind($before, [string[]]$keptPlaces = @(), [string]$keptKeys = '^$') {
  $now = Snapshot
  $left = @()
  foreach ($k in @($now.Places.Keys)) {
    if ($now.Places[$k] -ne $before.Places[$k] -and $keptPlaces -notcontains $k) { $left += "$k ($((Places)[$k]))" }
  }
  $diff = Compare-Object -ReferenceObject $before.Registry -DifferenceObject $now.Registry
  foreach ($d in $diff) {
    if ($d.InputObject -match $keptKeys) { continue }
    $sign = "removed: "
    if ($d.SideIndicator -eq "=>") { $sign = "added: " }
    $left += $sign + $d.InputObject
  }
  return $left
}

function Mark([string]$file) {
  $name = Split-Path -Leaf $file
  $zone = "[ZoneTransfer]`r`nZoneId=3`r`nReferrerUrl=https://github.com/proscenium-app/proscenium/releases`r`nHostUrl=https://github.com/proscenium-app/proscenium/releases/download/$name`r`n"
  Set-Content -Path $file -Stream Zone.Identifier -Value $zone -Encoding Ascii -NoNewline
  $read = Get-Content -Path $file -Stream Zone.Identifier -Raw
  if ($read -notmatch 'ZoneId=3') { throw "the mark did not stay on $file" }
  return "ZoneId=3 on $name"
}

function Marked([string]$file) {
  return [bool](Get-Item -Path $file -Stream Zone.Identifier -ErrorAction SilentlyContinue)
}

function ExecutionLevel([string]$file) {
  $text = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($file))
  $m = [regex]::Matches($text, 'requestedExecutionLevel\s+level="(\w+)"')
  if ($m.Count -eq 0) { throw "$(Split-Path -Leaf $file) has no requestedExecutionLevel" }
  $levels = @($m | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
  if ($levels.Count -ne 1 -or $levels[0] -ne "asInvoker") { throw "$(Split-Path -Leaf $file) asks for $($levels -join ', ')" }
  return "asInvoker"
}

$Settings = '{ "checkForUpdates": false, "shareAnalytics": false }'

function Seed([string]$dir) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $dir "settings.json"), $Settings)
}

# --- the machine ---------------------------------------------------------------

$os = Get-CimInstance Win32_OperatingSystem
$me = [System.Diagnostics.Process]::GetCurrentProcess()
$machine = "$($os.Caption), build $($os.BuildNumber), $($env:PROCESSOR_ARCHITECTURE); session $($me.SessionId); the job runs as an administrator: $(Elevated)"
Note $machine
Summary ""
Summary "#### The installed-artifact proof"
Summary ""
Summary "$machine. The first screen as ``$($Screen.File.Substring($Root.Length + 1))`` names it."

# --- the installer -------------------------------------------------------------

$before = Snapshot
foreach ($k in @($before.Places.Keys)) {
  if ($before.Places[$k]) { Note "  before the install, $k already exists: $((Places)[$k])" }
}

function Install {
  # Started with no shell between (-NoNewWindow is CreateProcess): the mark
  # stays on the file, and SmartScreen's first-run prompt, which a shell
  # raises and only a person answers, is not part of what a machine proves.
  $p = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "the installer exited $($p.ExitCode)" }
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product"
  if (-not (Test-Path $key)) { throw "no uninstall entry under HKCU" }
  if (Test-Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product") { throw "an uninstall entry under HKLM: not a per-user install" }
  $location = ((Get-ItemProperty $key).InstallLocation).Trim('"')
  if (-not (Test-Path (Join-Path $location "$AppExe.exe"))) { throw "no $AppExe.exe in $location" }
  if (-not $location.StartsWith($env:LOCALAPPDATA)) { throw "installed in $location, outside this user's own folders" }
  return $location
}

function Uninstalled {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product"
  return (-not (Test-Path $key)) -and (-not (Test-Path (Join-Path $script:Location "$AppExe.exe")))
}

$script:Location = $null
$script:App = $null
$script:Window = $null

Step "the installer carries the mark of the web" { Mark $Installer }
Step "the installer asks for no administrator" { ExecutionLevel $Installer }
Step "installed for this user, silently" {
  $script:Location = Install
  $shortcut = (Places)["Start menu entry"]
  if (-not (Test-Path $shortcut)) { throw "no Start menu entry at $shortcut" }
  $play = (Get-Item "HKCU:\Software\Classes\.proscenium" -ErrorAction SilentlyContinue)
  if (-not $play -or -not $play.GetValue("")) { throw "no .proscenium file type under HKCU" }
  foreach ($ext in @("fountain", "fdx", "docx", "odt", "rtf", "txt", "md", "pages")) {
    $with = Get-Item "HKCU:\Software\Classes\.$ext\OpenWithProgids" -ErrorAction SilentlyContinue
    if (-not $with -or ($with.GetValueNames() -notcontains "Proscenium.Draft")) { throw ".$ext has no Open With entry for the app" }
  }
  "in $($script:Location); .proscenium is $($play.GetValue('')); eight types in Open With"
}
Step "nothing the installer put there carries the mark" {
  $installed = @(Get-ChildItem -Path $script:Location -Recurse -File)
  $marked = @($installed | Where-Object { Marked $_.FullName })
  if ($marked.Count) { throw "marked: $(($marked | ForEach-Object { $_.FullName }) -join ', ')" }
  ExecutionLevel (Join-Path $script:Location "uninstall.exe") | Out-Null
  "$($installed.Count) files, none marked; the uninstaller asInvoker too"
}

Seed (Join-Path $env:APPDATA $BundleId)

Step "the app starts from its Start menu entry" {
  Start-Process -FilePath (Places)["Start menu entry"]
  $script:App = AppProcess (Join-Path $script:Location "$AppExe.exe")
  "process $($script:App.Id)"
}
Step "found by UI Automation: its window titled `"$Title`"" {
  $script:Window = Until 90 { TopWindow $script:App.Id $Title }
  if (-not $script:Window) { throw "no window titled `"$Title`" from process $($script:App.Id)" }
  "window class $($script:Window.Current.ClassName)"
}
Step "its first screen in the tree" { ReadFirstScreen $script:Window }
Step "closed through its window" { CloseThroughWindow $script:Window $script:App }

Step "uninstalled silently: nothing left but what the writer made" {
  $p = Start-Process -FilePath (Join-Path $script:Location "uninstall.exe") -ArgumentList "/S" -PassThru -Wait -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "the uninstaller exited $($p.ExitCode)" }
  # It runs from a copy of itself in the temporary folder, and returns first.
  if (-not (Until 120 { Uninstalled })) { throw "the app was still installed two minutes on" }
  Until 30 { -not (Test-Path $script:Location) } | Out-Null
  $kept = "^HKCU\\Software\\$([regex]::Escape($Maker))(\\| |$)"
  $left = LeftBehind $before @("app data (roaming)", "app data (local)") $kept
  if ($left.Count) { throw "left behind: $($left -join '; ')" }
  $data = @("app data (roaming)", "app data (local)") | Where-Object { Test-Path (Places)[$_] }
  "kept: $($data -join ', '), and HKCU\Software\$Maker\$Product"
}

Step "installed again" {
  $script:Location = Install
  "in $($script:Location)"
}

Step "uninstalled from Settings with its data: nothing at all left" {
  # Settings > Apps runs the uninstall entry's own command.
  $command = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product").UninstallString
  Start-Process -FilePath $command.Trim().Trim('"') | Out-Null
  $dialog = Until 60 {
    $A::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition) |
      Where-Object { $_.Current.Name -like "*$Product*" -and $_.Current.Name -like "*Uninstall*" } | Select-Object -First 1
  }
  if (-not $dialog) { throw "no uninstall window appeared" }
  $window = [IntPtr]$dialog.Current.NativeWindowHandle
  $W = [ProofNative.Win32]
  $box = Until 30 { $b = $W::CheckBox($window); if ($b -ne [IntPtr]::Zero) { $b } }
  if (-not $box) { throw "the uninstall window has no box to tick" }
  $boxName = $W::Text($box) -replace '&', ''
  # BM_SETCHECK to BST_CHECKED, then BM_GETCHECK: the state the page reads back when it leaves.
  $W::SendMessage($box, 0x00F1, [IntPtr]1, [IntPtr]::Zero) | Out-Null
  if ($W::SendMessage($box, 0x00F0, [IntPtr]::Zero, [IntPtr]::Zero) -ne [IntPtr]1) { throw "`"$boxName`" would not tick" }
  # The dialog's own button 1, Uninstall and then Close, pressed as its click
  # reaches the dialog (WM_COMMAND), which needs no window in front.
  $go = $W::GetDlgItem($window, 1)
  $label = $W::Text($go) -replace '&', ''
  if ($label -ne "Uninstall") { throw "the dialog's button says `"$label`", not Uninstall" }
  $W::PostMessage($window, 0x0111, [IntPtr]1, $go) | Out-Null
  $done = Until 120 { ($W::Text($go) -replace '&', '') -eq "Close" -and $W::IsWindowEnabled($go) }
  if (-not $done) { throw "the uninstall never finished: its button says `"$($W::Text($go))`"" }
  $W::PostMessage($window, 0x0111, [IntPtr]1, $go) | Out-Null
  if (-not (Until 60 { Uninstalled })) { throw "the app was still installed" }
  Until 30 { -not (Test-Path $script:Location) } | Out-Null
  $left = LeftBehind $before
  if ($left.Count) { throw "left behind: $($left -join '; ')" }
  "with `"$boxName`" ticked"
}

# --- the Store's package ---------------------------------------------------------

$before = Snapshot
$script:Package = $null
$script:Thumbprint = $null

Step "the Store's package carries the mark of the web" { Mark $Msix }
Step "its throwaway certificate trusted on this machine alone" {
  if (-not (Elevated)) { throw "trusting a certificate for the machine needs an administrator, and this job is not one" }
  $cert = Import-Certificate -FilePath $Cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
  $script:Thumbprint = $cert.Thumbprint
  "$($cert.Subject), until $($cert.NotAfter.ToString('yyyy-MM-dd'))"
}
Step "installed for this user" {
  if (Get-AppxPackage -Name $PackageName) { throw "$PackageName was installed before the proof" }
  Add-AppxPackage -Path $Msix
  $script:Package = Get-AppxPackage -Name $PackageName
  if (-not $script:Package) { throw "$PackageName is not installed" }
  if (-not (Test-Path (Join-Path $script:Package.InstallLocation "$AppExe.exe"))) { throw "the package holds no $AppExe.exe" }
  "$($script:Package.PackageFullName)"
}

$Store = Join-Path $env:LOCALAPPDATA "Packages\$($script:Package.PackageFamilyName)"
# The manifest's one application.
$Aumid = "$($script:Package.PackageFamilyName)!Proscenium"

function StartEntry {
  if (-not (Get-Command Get-StartApps -ErrorAction SilentlyContinue)) { return $null }
  return [bool](Get-StartApps | Where-Object { $_.AppID -eq $Aumid })
}

Seed (Join-Path $Store "LocalCache\Roaming\$BundleId")

Step "the app starts from its Start menu entry" {
  if ((StartEntry) -eq $false) { throw "no Start menu entry for $Aumid" }
  Start-Process -FilePath "shell:AppsFolder\$Aumid"
  $script:App = AppProcess (Join-Path $script:Package.InstallLocation "$AppExe.exe")
  "$Aumid, process $($script:App.Id)"
}
Step "found by UI Automation: its window titled `"$Title`"" {
  $script:Window = Until 90 { TopWindow $script:App.Id $Title }
  if (-not $script:Window) { throw "no window titled `"$Title`" from process $($script:App.Id)" }
  "window class $($script:Window.Current.ClassName)"
}
Step "its first screen in the tree" { ReadFirstScreen $script:Window }
Step "closed through its window" { CloseThroughWindow $script:Window $script:App }
Step "its data stayed in the package's own store" {
  foreach ($real in @((Join-Path $env:APPDATA $BundleId), (Join-Path $env:LOCALAPPDATA $BundleId))) {
    if (Test-Path $real) {
      $what = @(Get-ChildItem -Path $real -Recurse -Depth 1 -Force | ForEach-Object { $_.FullName.Substring($real.Length + 1) } | Select-Object -First 20)
      throw "it wrote outside its store: $real, holding $($what -join ', ')"
    }
  }
  $seeded = Get-Content -Raw (Join-Path $Store "LocalCache\Roaming\$BundleId\settings.json") | ConvertFrom-Json
  if ($seeded.checkForUpdates -ne $false) { throw "the seeded settings were not the ones it kept" }
  "settings.json in $Store"
}
Step "removed: nothing left" {
  Remove-AppxPackage -Package $script:Package.PackageFullName
  if (Get-AppxPackage -Name $PackageName) { throw "the package is still installed" }
  Until 60 { -not (Test-Path $Store) } | Out-Null
  if (Test-Path $Store) { throw "its store is still there: $Store" }
  if (StartEntry) { throw "its Start menu entry is still there" }
  Remove-Item -Path "Cert:\LocalMachine\TrustedPeople\$($script:Thumbprint)"
  # Windows' own package manager registers a package's file types under the
  # user's classes, and on removal takes its values away but leaves each
  # type's key, empty: no value of the package's is in them, and nothing the
  # package does can remove them. Every other difference is the package's.
  $windows = '^added: HKCU\\Software\\Classes\\\.[a-z]+\\(OpenWithProgids\\)?$'
  $left = @(LeftBehind $before)
  $empty = @($left | Where-Object { $_ -match $windows })
  $rest = @($left | Where-Object { $_ -notmatch $windows })
  if ($rest.Count) { throw "left behind: $($rest -join '; ')" }
  $tail = ""
  if ($empty.Count) { $tail = "; Windows' package manager left $($empty.Count) empty file-type keys, holding nothing" }
  "the certificate taken back out$tail"
}

Finish 0
