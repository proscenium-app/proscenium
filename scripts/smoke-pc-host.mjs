// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The PC around the real Windows app, for the checks that stage what a
 * writer's PC does to their files (scripts/smoke-checks.mjs, the acts whose
 * `engines` are the real Windows app's alone). Smoke's WebView2 engine gives
 * each act's page one of these as `page.host` (scripts/smoke.mjs).
 *
 * It runs in smoke's own process, on the PC, beside the app: to the app it is
 * another program. It reaches only the act's own Plays folder, a fresh copy of
 * the sample plays, and nothing else on the machine.
 *
 *   host.read(rel)            a file's text as the disk holds it, or null
 *   host.readOnly(rel, on)    Windows' Read-only on a file, set or cleared
 *   host.isReadOnly(rel)
 *   await host.hold(rel)      another program holds the file open, as an editor
 *                             that has it open does: reading it, and letting
 *                             others only read. `release()` lets it go.
 *   await host.syncIn(play)   a sync client brings a play from another device,
 *                             a file at a time, in an act whose plays begin
 *                             there (`launch.oneDrive`)
 *   host.rewrite(rel, text)   a sync client delivers another device's version
 *   host.copyPlay(from, to)   a play another machine named, made from one of these
 *   host.attributes(rel, f)   Windows' file attributes, as `attrib` sets them
 *   host.files()              every file in the Plays folder, as vault paths
 *   host.cloudFiles()         every file on the other device, the same way
 *   await host.dispose()      every hold let go, at the act's end
 *
 * Where an act's plays live is its launch's (`actLayout`, below): the folder
 * "A folder I choose…" picks, by default; a Documents › Plays inside OneDrive,
 * as Windows' Known Folder Move leaves a writer's Documents, for an act whose
 * `launch` says `oneDrive`; a Plays folder deep in the disk, named in other
 * scripts, for one that says `deep`.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** When the sample plays were last changed, for every act on every machine. */
export const FIXTURE_DATE = new Date("2026-01-05T15:00:00Z");

/**
 * A copy of the sample plays at `to`, every file dated FIXTURE_DATE whatever
 * the checkout's: a fresh clone's files are today's, and the Plays screen
 * says "Today" of them.
 */
export function seedPlays(from, to) {
  cpSync(from, to, { recursive: true });
  for (const file of readdirSync(to, { recursive: true }))
    utimesSync(join(to, String(file)), FIXTURE_DATE, FIXTURE_DATE);
}

/**
 * Where an act's plays live, and what its launch tells the app of the PC:
 * `{ plays, seed, outside, cloud, env, unset }`. `seed` is where the sample
 * plays are copied, and `outside` where the files a check opens from outside
 * the Plays folder are; `plays` is the folder the app's picker answers; `env` is added to
 * the app's environment and `unset` taken from it (matched without case, as
 * Windows matches a variable's name).
 */
export function actLayout(run, launch = {}) {
  const layout = playsLayout(run, launch);
  // WebView2 started in another display language (the test build passes it
  // on as WebView2's own `--lang`): the PC's language, for this app alone.
  if (launch.lang) layout.env = { ...layout.env, PROSCENIUM_SELFTEST_LANG: launch.lang };
  return layout;
}

function playsLayout(run, launch) {
  if (launch.oneDrive) {
    // A writer whose Documents OneDrive keeps (Known Folder Move): OneDrive's
    // own variable names its folder, Documents is inside it, and Plays is not
    // there yet. The plays begin on the writer's other device, and come down
    // as the sync client brings them (`syncIn`).
    const oneDrive = join(run, "OneDrive");
    const documents = join(oneDrive, "Documents");
    mkdirSync(documents, { recursive: true });
    return {
      plays: join(documents, "Plays"),
      seed: join(run, "cloud"),
      outside: null,
      cloud: join(run, "cloud"),
      env: {
        OneDrive: oneDrive,
        OneDriveConsumer: oneDrive,
        PROSCENIUM_SELFTEST_DOCUMENTS: documents,
      },
      unset: ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"],
    };
  }
  if (launch.deep) {
    // A Plays folder deep in the disk, each folder on the way named in
    // another script, so a play's own paths pass Windows' old limit of 260
    // characters once its names are long.
    const plays = deepPlays(run);
    return { plays, seed: plays, outside: null, cloud: null, env: {}, unset: [] };
  }
  // The Plays folder in a folder called `dev`, which also holds the files a
  // check opens from outside it (`outside`, copied there from sample-outside/).
  const dev = join(run, "dev");
  const plays = join(dev, "plays");
  return { plays, seed: plays, outside: dev, cloud: null, env: {}, unset: [] };
}

/** The folders on the way to a deep Plays folder, in the scripts writers name them in. */
export const DEEP_FOLDERS = [
  "Écrits et brouillons",
  "Сочинения",
  "戯曲と脚本",
  "مسرحيات",
  "नाटक और पटकथा",
  "Θεατρικά έργα",
  "희곡 원고",
];

/** How long a deep Plays folder's own path is, at least, whatever the run's folder. */
export const DEEP_LENGTH = 160;

/** The deep Plays folder under `run`: DEEP_FOLDERS over and over, then Plays. */
export function deepPlays(run) {
  let path = run;
  for (let i = 0; path.length + "Plays".length + 1 < DEEP_LENGTH; i++)
    path = join(path, DEEP_FOLDERS[i % DEEP_FOLDERS.length]);
  return join(path, "Plays");
}

/** The app's environment for an act: this process's, with its layout's. */
export function launchEnv(base, layout, own) {
  const env = { ...base };
  const unset = new Set(layout.unset.map((k) => k.toLowerCase()));
  for (const key of Object.keys(env)) if (unset.has(key.toLowerCase())) delete env[key];
  return { ...env, ...layout.env, ...own };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Every file under `dir`, as `/`-separated paths relative to it, sorted. */
function filesIn(dir) {
  try {
    return readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => statSync(join(dir, f)).isFile())
      .map((f) => f.split(sep).join("/"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The holding program: PowerShell opens the file for reading, sharing it for
 * reading alone (as a word processor holds a document it has open), says so,
 * and keeps it until its input ends.
 */
const HOLD = [
  "$ErrorActionPreference = 'Stop'",
  "$f = [System.IO.File]::Open($env:PROSCENIUM_SMOKE_HOLD, 'Open', 'Read', 'Read')",
  "[Console]::Out.WriteLine('held')",
  "[Console]::Out.Flush()",
  "[void][Console]::In.ReadLine()",
  "$f.Dispose()",
  "[Console]::Out.WriteLine('let go')",
  "[Console]::Out.Flush()",
].join("; ");

/** How long the holding program may take to start and open the file. */
const HOLD_START_MS = 60000;

/**
 * A vault path, `/`-separated and relative to the Plays folder, as an
 * absolute path inside it; anything that would leave the folder throws.
 */
export function insidePlays(plays, rel) {
  const root = resolve(plays);
  const path = resolve(root, ...String(rel).split("/"));
  const back = relative(root, path);
  if (
    /^([\\/]|[A-Za-z]:)/.test(String(rel)) ||
    !back ||
    back.startsWith("..") ||
    back.includes(`..${sep}`) ||
    resolve(back) === back
  )
    throw new Error(`${rel} is not inside the act's Plays folder`);
  return path;
}

export function pcHost({ plays, cloud = null }) {
  const at = (rel) => insidePlays(plays, rel);
  const holds = new Set();
  return {
    plays,
    path: at,
    async syncIn(play, { gapMs = 250 } = {}) {
      if (!cloud) throw new Error("this act's plays do not begin on another device");
      const from = insidePlays(cloud, play);
      const names = readdirSync(from, { recursive: true }).map(String).sort();
      mkdirSync(at(play), { recursive: true });
      for (const name of names) {
        const source = join(from, name);
        const target = join(at(play), name);
        if (statSync(source).isDirectory()) {
          mkdirSync(target, { recursive: true });
          continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        // Written whole, then given the date it has on the other device, as
        // a sync client keeps a file's modified time.
        writeFileSync(target, readFileSync(source));
        utimesSync(target, FIXTURE_DATE, FIXTURE_DATE);
        await sleep(gapMs);
      }
    },
    copyPlay(from, to) {
      // A play another machine named `to`: `from`'s folder, its play file and
      // its script renamed for it, and an identity of its own.
      const dir = at(to);
      cpSync(at(from), dir, { recursive: true });
      for (const ext of ["proscenium", "fountain"])
        renameSync(join(dir, `${from}.${ext}`), join(dir, `${to}.${ext}`));
      const file = join(dir, `${to}.proscenium`);
      const play = JSON.parse(readFileSync(file, "utf8"));
      play.id = `${play.id.slice(0, -2)}99`;
      const rename = (items) => {
        for (const item of items ?? []) {
          if (item.path === `${from}.fountain`) item.path = `${to}.fountain`;
          rename(item.children);
        }
      };
      rename(play.binder);
      writeFileSync(file, `${JSON.stringify(play, null, 2)}\n`);
      for (const f of readdirSync(dir, { recursive: true }))
        utimesSync(join(dir, String(f)), FIXTURE_DATE, FIXTURE_DATE);
    },
    rewrite(rel, text) {
      // Downloaded beside it, then put in its place, as a sync client delivers
      // another device's version.
      const target = at(rel);
      const part = join(dirname(target), `.${Date.now()}.download`);
      writeFileSync(part, text);
      renameSync(part, target);
    },
    attributes(rel, flags, { recursive = false } = {}) {
      const args = recursive ? [...flags, join(at(rel), "*"), "/S", "/D"] : [...flags, at(rel)];
      const r = spawnSync("attrib.exe", args, { encoding: "utf8" });
      if (r.status !== 0 || /\S/.test(r.stdout ?? ""))
        throw new Error(`attrib ${flags.join(" ")} ${rel}: ${(r.stdout || r.stderr || "").trim()}`);
    },
    files() {
      return filesIn(plays);
    },
    cloudFiles() {
      return cloud ? filesIn(cloud) : [];
    },
    read(rel) {
      try {
        return readFileSync(at(rel), "utf8");
      } catch {
        return null;
      }
    },
    readOnly(rel, on) {
      chmodSync(at(rel), on ? 0o444 : 0o666);
    },
    isReadOnly(rel) {
      return (statSync(at(rel)).mode & 0o200) === 0;
    },
    async hold(rel) {
      const path = at(rel);
      const child = spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", HOLD],
        {
          env: { ...process.env, PROSCENIUM_SMOKE_HOLD: path },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      let said = "";
      let err = "";
      child.stderr.on("data", (d) => {
        err += d;
      });
      const exited = new Promise((done) => child.once("exit", done));
      await new Promise((done, fail) => {
        const timer = setTimeout(() => {
          child.kill();
          fail(new Error(`the holding program never held ${rel}: ${err.trim() || "no word"}`));
        }, HOLD_START_MS);
        child.stdout.on("data", (d) => {
          said += d;
          if (said.includes("held")) {
            clearTimeout(timer);
            done();
          }
        });
        exited.then((code) => {
          clearTimeout(timer);
          fail(
            new Error(`the holding program ended (${code}) before it held ${rel}: ${err.trim()}`),
          );
        });
      });
      let released = null;
      const release = () => {
        released ??= (async () => {
          // Let go the moment the program says it closed the file, not when
          // its process has wound down, which on a loaded PC is later.
          const letGo = new Promise((done) => {
            const listen = () => (said.includes("let go") ? done(true) : null);
            child.stdout.on("data", listen);
            listen();
          });
          child.stdin.end("\n");
          const ended = await Promise.race([
            letGo,
            exited.then(() => true),
            new Promise((done) => setTimeout(() => done(false), 5000)),
          ]);
          if (!ended) child.kill();
          holds.delete(release);
        })();
        return released;
      };
      holds.add(release);
      return { release };
    },
    async dispose() {
      for (const release of [...holds]) await release();
    },
  };
}
