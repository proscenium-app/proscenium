// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Refuse to start a build that would fill the disk.
 *
 *   node scripts/disk-floor.mjs                 check, with the default reserve
 *   node scripts/disk-floor.mjs --reserve-gb 6  check against a smaller build
 *   node scripts/disk-floor.mjs --sweep         list the build output that is safe to delete
 *   node scripts/disk-floor.mjs --sweep --idle-days 7   …counting a worktree idle after 7 days
 *
 * A Rust target directory is the largest thing this repository makes: a few
 * gigabytes for a cold debug build, and a couple more for a universal release
 * (the numbers are under DEFAULT_RESERVE_GB, with the date they were measured).
 * On a machine that also runs other work, a build that runs the disk down does
 * two kinds of damage —
 * it dies halfway through with a link error that reads like a code fault, and
 * it trips whatever watches the disk for the machine's real owner.
 *
 * So the floor is not "enough to finish". It is the monitor's alarm line plus
 * what this build will eat, which means a build that passes this check can
 * finish AND leave the alarm silent. Below it, the build does not start, and
 * says which of the two it would have broken.
 *
 * MONITOR_PCT is the line the host's disk monitor alarms at. It is a constant
 * here rather than a lookup, because a build must not depend on another
 * program's files being installed, or readable, or in the shape they were
 * yesterday. Raise it when the monitor's line moves.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, statfsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Percent free at which the host's disk monitor raises an alarm. */
export const MONITOR_PCT = 10;

/**
 * Gigabytes of build output to leave room for, above the alarm line.
 *
 * Measured 2026-09-21 on a build host with a cold target: `cargo test` alone
 * took 2.6 GB, clippy `--all-targets` took it to 3.3 GB, and a universal
 * release with its disk image finished at 5.7 GB. The default is roughly twice
 * the whole of that, because the number that matters is not what a build uses
 * but what is left when it is wrong.
 *
 * An old, much-used checkout can hold four times as much — a machine's main
 * target was 24 GB the same day — but that is years of accumulated profiles
 * and other platforms' slices, not what one build needs. Sizing the floor for
 * it would refuse builds that had room.
 */
export const DEFAULT_RESERVE_GB = 12;

const GB = 1024 ** 3;

export function diskState(path = ROOT) {
  const fs = statfsSync(path);
  return {
    totalBytes: fs.blocks * fs.bsize,
    // bavail, not bfree: bfree counts blocks reserved for root, which a build
    // cannot have. Reporting space that cannot be written is how a check
    // passes and the build still dies.
    freeBytes: fs.bavail * fs.bsize,
  };
}

export function floorBytes(totalBytes, reserveGb = DEFAULT_RESERVE_GB) {
  return (totalBytes * MONITOR_PCT) / 100 + reserveGb * GB;
}

const gb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;

/** Days without a build or a commit after which a worktree's target is listed. */
export const IDLE_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

/** Every folder in a target that holds a profile: target/<profile>, target/<triple>/<profile>. */
export function profiles(target) {
  const dirs = (path) => {
    try {
      return readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(path, d.name));
    } catch {
      return [];
    }
  };
  const found = [];
  for (const a of dirs(target)) {
    if (existsSync(join(a, ".fingerprint"))) found.push(a);
    else for (const b of dirs(a)) if (existsSync(join(b, ".fingerprint"))) found.push(b);
  }
  return found;
}

/** The lock files Cargo holds while it builds in a target. */
export function cargoLocks(target) {
  return profiles(target).flatMap((p) => [".cargo-lock", ".cargo-build-lock", ".cargo-artifact-lock"]
    .map((f) => join(p, f)).filter(existsSync));
}

/**
 * Whether a cargo holds a target's lock right now. Cargo takes its lock files
 * with flock(2) for the whole of a build; a shared lock that cannot be had
 * without waiting means one is running there.
 */
export function targetInUse(target) {
  const locks = cargoLocks(target);
  if (!locks.length) return false;
  const r = spawnSync("perl", ["-MFcntl=:flock", "-e", `
    my @held;
    for my $lock (@ARGV) {
      open(my $fh, "<", $lock) or next;
      flock($fh, LOCK_SH | LOCK_NB) or exit 75;
      push @held, $fh;
    }
  `, ...locks]);
  return r.status === 75;
}

/**
 * When a worktree last built or moved: the newest of its target's profile
 * folders and the folders in them (Cargo adds and renames entries there on
 * every build that does anything), its index and its HEAD's log.
 */
function lastActivity(path, target) {
  const times = [];
  const mtime = (p) => {
    try {
      times.push(statSync(p).mtimeMs);
    } catch { /* gone, or never made */ }
  };
  mtime(target);
  for (const p of profiles(target)) {
    mtime(p);
    for (const sub of ["deps", ".fingerprint", "build", "incremental"]) mtime(join(p, sub));
  }
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir"],
      { cwd: path, encoding: "utf8" }).trim();
    mtime(join(gitDir, "index"));
    mtime(join(gitDir, "logs/HEAD"));
  } catch { /* not a checkout any more */ }
  return Math.max(0, ...times);
}

/**
 * Build output that can be deleted without losing anything a person wrote:
 * the target directory of a worktree whose HEAD is already in main — on a
 * merged branch or, as Claude's worktrees are, detached — or of one nobody has
 * built in or committed from for more than `idleDays`. Cargo rebuilds them;
 * nothing else is in them. The main checkout is never listed, because its
 * target is the warm build new worktrees clone (scripts/worktree-target.sh),
 * nor is the checkout running this, nor a target a cargo is building in now.
 *
 * This only ever LISTS. Deleting is a separate, deliberate act, because
 * several sessions share this checkout and one of them may be building in the
 * very worktree whose branch merged an hour ago — a sweep that runs itself
 * before every build would eventually delete a target out from under a
 * running cargo. The lock check narrows that window; it does not close it,
 * since a build can start the moment after the list is made.
 */
export function sweepable({ root = ROOT, idleDays = IDLE_DAYS, now = Date.now() } = {}) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let worktrees = [];
  try {
    git(["rev-parse", "--verify", "--quiet", "main^{commit}"]);
    worktrees = git(["worktree", "list", "--porcelain"]).trim().split("\n\n");
  } catch {
    return [];                       // Not a checkout with a main. Nothing to say.
  }
  let here = root;
  try {
    here = git(["rev-parse", "--show-toplevel"]).trim();
  } catch { /* root itself, then */ }

  const found = [];
  for (const [i, block] of worktrees.entries()) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    const head = block.match(/^HEAD ([0-9a-f]+)$/m)?.[1];
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    if (!path || i === 0 || resolve(path) === resolve(here)) continue;
    const target = join(path, "src-tauri/target");
    if (!existsSync(target) || targetInUse(target)) continue;

    let merged = false;
    if (head) {
      try {
        git(["merge-base", "--is-ancestor", head, "main"]);
        merged = true;
      } catch { /* not in main, or not a commit git knows */ }
    }
    const idle = Math.floor((now - lastActivity(path, target)) / DAY);
    let reason;
    if (merged) reason = branch ? `branch ${branch} is in main` : `detached at ${head.slice(0, 7)}, in main`;
    else if (idle > idleDays) reason = `idle ${idle} days`;
    else continue;

    let bytes = 0;
    try {
      bytes = Number(execFileSync("du", ["-sk", target], { encoding: "utf8" })
        .split(/\s+/)[0]) * 1024;
    } catch { /* an unreadable target is not worth failing over */ }
    found.push({ name: branch ?? `${basename(path)} (detached)`, target, reason, idleDays: idle, bytes });
  }
  return found;
}

// `du` counts an APFS clone in full, and a worktree's target starts as one
// (scripts/worktree-target.sh), so deleting it can free less than listed.
const SWEEP_NOTE = "sizes are du's, which counts an APFS clone in full: deleting one can free less";

function sweepLine(s) {
  return `${gb(s.bytes).padStart(8)}  ${s.name}  (${s.reason}; last active ${s.idleDays} days ago)  ${s.target}`;
}

/**
 * Throw unless there is room for a build of this size. The message names the
 * numbers, because "not enough disk space" sends someone to `df` to work out
 * what the program already knew.
 */
export function requireDiskFloor({ reserveGb = DEFAULT_RESERVE_GB, label = "this build" } = {}) {
  const { totalBytes, freeBytes } = diskState();
  const floor = floorBytes(totalBytes, reserveGb);
  if (freeBytes >= floor) return { ok: true, freeBytes, floor };

  const alarm = (totalBytes * MONITOR_PCT) / 100;
  const lines = [
    `disk-floor: refusing to start ${label}.`,
    `  free now   ${gb(freeBytes)}`,
    `  floor      ${gb(floor)}  =  ${gb(alarm)} (the ${MONITOR_PCT}% alarm line) + ${reserveGb} GB for the build`,
    freeBytes < alarm
      ? "  The disk is already below the alarm line; a build is not the problem to fix first."
      : `  A build of this size would take the disk below the alarm line and set off the host's disk monitor.`,
  ];

  const sweep = sweepable();
  if (sweep.length) {
    const total = sweep.reduce((n, s) => n + s.bytes, 0);
    lines.push(`  ${gb(total)} is build output of worktrees merged or idle, and can be deleted (${SWEEP_NOTE}):`);
    for (const s of sweep) lines.push(`    ${sweepLine(s)}`);
    lines.push("  Check no session is about to build in one, delete those targets, then run this again.");
  } else {
    lines.push("  No merged or idle worktree has build output to reclaim. Free space elsewhere.");
  }

  throw new Error(lines.join("\n"));
}

// --- CLI ---------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--reserve-gb");
  const reserveGb = at === -1 ? DEFAULT_RESERVE_GB : Number(args[at + 1]);
  if (!Number.isFinite(reserveGb) || reserveGb < 0) {
    console.error("disk-floor: --reserve-gb takes a number of gigabytes");
    process.exit(2);
  }

  if (args.includes("--sweep")) {
    const idleAt = args.indexOf("--idle-days");
    const idleDays = idleAt === -1 ? IDLE_DAYS : Number(args[idleAt + 1]);
    if (!Number.isFinite(idleDays) || idleDays < 0) {
      console.error("disk-floor: --idle-days takes a number of days");
      process.exit(2);
    }
    const sweep = sweepable({ idleDays });
    if (!sweep.length) console.log("disk-floor: no merged or idle worktree has build output to reclaim.");
    else console.log(`disk-floor: ${SWEEP_NOTE}.`);
    for (const s of sweep) console.log(sweepLine(s));
    process.exit(0);
  }

  try {
    const { freeBytes, floor } = requireDiskFloor({ reserveGb });
    console.log(`disk-floor: ok — ${gb(freeBytes)} free, floor ${gb(floor)}.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
