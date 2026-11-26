// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The iPad's half of the bundle's gate (scripts/check-bundle.mjs --ios),
 * which every iPad build passes before it is uploaded
 * (docs/engineering/cross-platform.md#PLAT-65):
 *
 *   node scripts/check-bundle.mjs --ios <Proscenium.ipa | Proscenium.app> [--build N.u]
 *        [--version X.Y.Z] [--whole X.Y.Z-alpha.N] [--reports]
 *
 *   - arm64 alone, in the app's executable;
 *   - the iPad alone (UIDeviceFamily 2) and the floor in tauri.conf.json
 *     (`bundle.iOS.minimumSystemVersion`), as the plist and the loader read it;
 *   - the version the build was given (package.json's, a release's, unless
 *     `--version` names another), its whole version in `ProsceniumVersion`
 *     for a track build (`--whole`) and none for a release, and the build
 *     number the upload was given;
 *   - with `--reports`, the reports compiled in, by the binary's own mark;
 *   - the privacy manifest's collected data types, as the App Store record's
 *     privacy answers name them: the reports' three when they are compiled
 *     in, and feedback's two always;
 *   - `ITSAppUsesNonExemptEncryption` false, so App Store Connect asks no
 *     export-compliance question of the build;
 *   - the privacy manifest, declaring every "required reason" API the binary
 *     imports: App Store Connect refuses an upload that leaves one out;
 *   - signed with an Apple Distribution identity, with an App Store profile of
 *     the app's own identifier and team, that lets no debugger attach;
 *   - nothing of a test build: none of the self-test's, the update proof's,
 *     the iPad probe's or the updater's words, and no developer tools in the
 *     web view, which Apple's guideline 2.5.19 refuses as hidden features.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd, argv) =>
  execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A plist's whole content as JSON: only a plist with no <data> or <date> in it. */
function plistJson(path) {
  return JSON.parse(run("plutil", ["-convert", "json", "-o", "-", path]));
}

/** One scalar of a plist by its key path (dots in a key escaped), or null. */
function plistField(path, keyPath) {
  const r = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", path], {
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Whether a plist holds a key at all, whatever its value's type. */
function plistHas(path, keyPath) {
  return (
    spawnSync("plutil", ["-extract", keyPath, "xml1", "-o", "-", path], { encoding: "utf8" })
      .status === 0
  );
}

/**
 * "Required reason" APIs by the symbols a binary imports for them, as Apple's
 * privacy manifest names their categories.
 */
export const REQUIRED_REASON_SYMBOLS = [
  [
    "NSPrivacyAccessedAPICategoryFileTimestamp",
    /^_(stat|fstat|fstatat|lstat|getattrlist|fgetattrlist|getattrlistat|getattrlistbulk)(\$INODE64)?$/,
  ],
  ["NSPrivacyAccessedAPICategorySystemBootTime", /^_mach_absolute_time$/],
  ["NSPrivacyAccessedAPICategoryDiskSpace", /^_(statfs|fstatfs|statvfs|fstatvfs)(\$INODE64)?$/],
  ["NSPrivacyAccessedAPICategoryUserDefaults", /^_OBJC_CLASS_\$_NSUserDefaults$/],
];

/** The categories a binary's imported symbols reach, each once. Pure. */
export function categoriesReached(symbols) {
  const reached = new Set();
  for (const symbol of symbols)
    for (const [category, re] of REQUIRED_REASON_SYMBOLS)
      if (re.test(symbol.trim())) reached.add(category);
  return [...reached].sort();
}

/** The categories a privacy manifest declares, each with at least one reason. Pure. */
export function categoriesDeclared(manifest) {
  return (manifest?.NSPrivacyAccessedAPITypes ?? [])
    .filter((t) => (t.NSPrivacyAccessedAPITypeReasons ?? []).length > 0)
    .map((t) => t.NSPrivacyAccessedAPIType)
    .sort();
}

/**
 * What the iPad's build collects, as the App Store record's privacy answers
 * say it for the Mac and the iPad alike
 * (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-82): each data type,
 * whether it is linked to the writer, and its purposes. Never tracking. The
 * reports' three are the build's only when they are compiled in; the
 * feedback's two are every build's, sent only when the writer presses Send.
 */
export const COLLECTED = {
  reports: {
    NSPrivacyCollectedDataTypeProductInteraction: { linked: false, purposes: ["Analytics"] },
    NSPrivacyCollectedDataTypeCrashData: { linked: false, purposes: ["AppFunctionality"] },
    NSPrivacyCollectedDataTypeOtherDiagnosticData: {
      linked: false,
      purposes: ["Analytics", "AppFunctionality"],
    },
  },
  feedback: {
    NSPrivacyCollectedDataTypeCustomerSupport: { linked: true, purposes: ["AppFunctionality"] },
    NSPrivacyCollectedDataTypeEmailAddress: { linked: true, purposes: ["AppFunctionality"] },
  },
};

/**
 * Where a manifest's collected data types differ from what the build sends:
 * none missing, none extra, each linked and purposed as the answers say, and
 * none for tracking. A build with no reports compiled in collects the
 * feedback's alone. Pure.
 */
export function collectedProblems(manifest, { reports }) {
  const want = { ...(reports ? COLLECTED.reports : {}), ...COLLECTED.feedback };
  const declared = new Map(
    (manifest?.NSPrivacyCollectedDataTypes ?? []).map((t) => [t.NSPrivacyCollectedDataType, t]),
  );
  const problems = [];
  for (const [type, rule] of Object.entries(want)) {
    const t = declared.get(type);
    const name = type.replace("NSPrivacyCollectedDataType", "");
    if (!t) {
      problems.push(`it does not declare ${name}, which the build sends`);
      continue;
    }
    const purposes = (t.NSPrivacyCollectedDataTypePurposes ?? [])
      .map((p) => String(p).replace("NSPrivacyCollectedDataTypePurpose", ""))
      .sort();
    if (t.NSPrivacyCollectedDataTypeLinked !== rule.linked)
      problems.push(`it says ${name} is ${rule.linked ? "not " : ""}linked to the writer`);
    if (t.NSPrivacyCollectedDataTypeTracking !== false)
      problems.push(`it does not say ${name} is never used for tracking`);
    if (purposes.join(",") !== [...rule.purposes].sort().join(","))
      problems.push(`it gives ${name} the purposes ${purposes.join(", ") || "none"}`);
  }
  for (const type of declared.keys())
    if (!Object.hasOwn(want, type))
      problems.push(
        `it declares ${String(type).replace("NSPrivacyCollectedDataType", "")}, which the build does not send`,
      );
  return problems;
}

/**
 * The version a build says, and the whole version in its own key, against
 * what it was given (scripts/release-ios.mjs): `version`, App Store Connect's
 * `X.Y.Z`; `whole`, a track build's `X.Y.Z-alpha.N` or `X.Y.Z-beta.N`, or null
 * for a release, which carries no key. Pure.
 */
export function versionProblems(info, { version, whole }) {
  const problems = [];
  if (info.CFBundleShortVersionString !== version)
    problems.push(
      `CFBundleShortVersionString is ${info.CFBundleShortVersionString}, not ${version}`,
    );
  const key = info.ProsceniumVersion ?? null;
  if (whole === null && key !== null)
    problems.push(`a release carries no ProsceniumVersion, and this one says ${key}`);
  if (whole !== null && key !== whole)
    problems.push(`ProsceniumVersion is ${key ?? "missing"}, not ${whole}`);
  if (whole !== null && !whole.startsWith(`${version}-`))
    problems.push(`${whole} is not a pre-release of ${version}`);
  return problems;
}

/** Words a shipped build never carries, by what they would mean. */
export const TEST_WORDS = [
  ["self-test code", /selftest|PROSCENIUM_UPDATE_PROOF/i],
  ["the iPad probe", /PROSCENIUM_IPAD_PROBE|ipad_probe/],
  ["the updater", /tauri[-_]plugin[-_]updater|plugin:updater|updates\.proscenium\.ink/],
  ["the web view's developer tools", /developerExtrasEnabled/],
];

export function checkIpad({
  target,
  build = null,
  version = null,
  whole = null,
  reports = false,
  root,
}) {
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  // The version the build was given, or package.json's, a release's.
  const expected = version ?? pkg.version;
  const floor = tauri.bundle?.iOS?.minimumSystemVersion;
  const failures = [];
  const passed = [];
  let scratch = null;
  let app = target;
  try {
    if (target.endsWith(".ipa")) {
      scratch = mkdtempSync(join(tmpdir(), "proscenium-ipa-"));
      run("ditto", ["-x", "-k", target, scratch]);
      const payload = join(scratch, "Payload");
      const name = existsSync(payload) && readdirSync(payload).find((n) => n.endsWith(".app"));
      if (!name) return { failures: [`${target} holds no Payload/*.app`], passed };
      app = join(payload, name);
    }
    const info = plistJson(join(app, "Info.plist"));
    const exe = join(app, info.CFBundleExecutable);

    // 1. arm64 alone, here and in every other Mach-O.
    const archs = run("lipo", ["-archs", exe]).trim();
    if (archs !== "arm64") failures.push(`lipo -archs says "${archs}", expected arm64 alone`);
    else passed.push("arm64 alone");

    // 2. The iPad alone, and the floor.
    const family = info.UIDeviceFamily ?? [];
    if (family.length !== 1 || family[0] !== 2)
      failures.push(`UIDeviceFamily is ${JSON.stringify(family)}, the iPad's alone is [2]`);
    else passed.push("the iPad alone");
    if (info.MinimumOSVersion !== floor)
      failures.push(`MinimumOSVersion is ${info.MinimumOSVersion}, the floor is ${floor}`);
    const shown = run("vtool", ["-show-build", exe]);
    const minos = shown.match(/minos\s+(\S+)/)?.[1];
    if (minos !== floor)
      failures.push(`the binary says minos ${minos ?? "(none)"}, the floor is ${floor}`);
    if (info.MinimumOSVersion === floor && minos === floor) passed.push(`iPadOS ${floor} floor`);

    // 3. One version, its whole version, and the build number given.
    const versions = versionProblems(info, { version: expected, whole });
    if (versions.length) failures.push(...versions);
    else passed.push(whole ? `version ${expected}, whole ${whole}` : `version ${expected}`);
    if (build && info.CFBundleVersion !== build)
      failures.push(`CFBundleVersion is ${info.CFBundleVersion}, the upload's is ${build}`);
    else if (!/^\d+\.\d+(\.\d+)?$/.test(String(info.CFBundleVersion)))
      failures.push(`CFBundleVersion is ${info.CFBundleVersion}, which App Store Connect refuses`);
    else passed.push(`build ${info.CFBundleVersion}`);

    // 4. No export-compliance question.
    if (info.ITSAppUsesNonExemptEncryption !== false)
      failures.push("Info.plist does not say ITSAppUsesNonExemptEncryption false");
    else passed.push("no export-compliance question");

    // 5. The privacy manifest, against what the binary imports.
    const manifestPath = join(app, "PrivacyInfo.xcprivacy");
    if (!existsSync(manifestPath)) {
      failures.push("the bundle has no PrivacyInfo.xcprivacy, which App Store Connect requires");
    } else {
      const manifest = plistJson(manifestPath);
      const symbols = run("xcrun", ["nm", "-u", exe]).split("\n");
      const reached = categoriesReached(symbols);
      const declared = new Set(categoriesDeclared(manifest));
      const undeclared = reached.filter((c) => !declared.has(c));
      if (undeclared.length)
        failures.push(
          `the privacy manifest does not declare ${undeclared.join(", ")}, which the binary imports`,
        );
      else if (manifest.NSPrivacyTracking !== false)
        failures.push("the privacy manifest does not say NSPrivacyTracking false");
      else
        passed.push(
          `privacy manifest (${reached.map((c) => c.replace("NSPrivacyAccessedAPICategory", "")).join(", ") || "nothing"} declared)`,
        );
      // What it says the build collects, against what this build sends.
      const collected = collectedProblems(manifest, { reports });
      if (collected.length) failures.push(...collected.map((p) => `the privacy manifest: ${p}`));
      else
        passed.push(
          `what it collects declared (${(manifest.NSPrivacyCollectedDataTypes ?? []).length} types)`,
        );
    }

    // 6. The signature and the profile.
    const signed = spawnSync("codesign", ["--verify", "--strict", "--deep", app], {
      encoding: "utf8",
    });
    if (signed.status !== 0)
      failures.push(
        `codesign does not verify the app: ${(signed.stderr || "").trim().slice(0, 200)}`,
      );
    const details = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr ?? "";
    const authority = details.match(/^Authority=(Apple Distribution: .+)$/m)?.[1];
    if (!authority) failures.push("the app is not signed with an Apple Distribution identity");
    const profilePath = join(app, "embedded.mobileprovision");
    if (!existsSync(profilePath)) {
      failures.push("the app embeds no provisioning profile");
    } else {
      const dir = mkdtempSync(join(tmpdir(), "proscenium-profile-"));
      try {
        const p = join(dir, "p.plist");
        run("security", ["cms", "-D", "-i", profilePath, "-o", p]);
        // Field by field: a profile carries <data> and <date> values, which
        // plutil's JSON cannot hold.
        const team = plistField(p, "Entitlements.com\\.apple\\.developer\\.team-identifier");
        const appId = plistField(p, "Entitlements.application-identifier");
        if (appId !== `${team}.${tauri.identifier}`)
          failures.push(`the profile is for ${appId}, not ${team}.${tauri.identifier}`);
        if (plistHas(p, "ProvisionedDevices") || plistField(p, "ProvisionsAllDevices") === "true")
          failures.push("the profile names devices: it is not an App Store profile");
        if (plistField(p, "Entitlements.get-task-allow") === "true")
          failures.push("the profile lets a debugger attach");
        if (!failures.some((f) => f.includes("profile")) && authority)
          passed.push(`signed by ${authority}, profile "${plistField(p, "Name")}"`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    // 7. Nothing of a test build.
    const bytes = readFileSync(exe).toString("latin1");
    const found = TEST_WORDS.filter(([, re]) => re.test(bytes)).map(([what]) => what);
    if (found.length) failures.push(`the binary carries ${found.join(", ")}`);
    else passed.push("nothing of a test build");

    // 8. Reports compiled in, when the build says it sends them, as the
    // privacy manifest then says it does (telemetry/client.rs's mark).
    if (reports) {
      if (bytes.includes("proscenium-reports-compiled-in")) passed.push("reports compiled in");
      else
        failures.push(
          bytes.includes("proscenium-reports-left-out")
            ? "the binary was built without reports (PROSCENIUM_REPORTS=1), which its privacy manifest says it sends"
            : "the binary carries no mark of whether it sends reports",
        );
    }
    return { failures, passed };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
