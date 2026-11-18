// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Microsoft Store's copy of a stable release
 * (docs/engineering/services-and-feedback.md#SERV-85): the release's two
 * packages, one for each chip, which its `store` stage held to the Store's
 * identity and kept on the build host, submitted to Partner Center with the
 * release's notes as What's new, to be published once certification passes.
 * On the build host, from its release keychain (`PROSCENIUM_KEYCHAIN`), as
 * the release machine's `store-submit` stage runs it (release-stage.yml).
 *
 *   node scripts/release-ms-store.mjs submit --version X.Y.Z [--out <dir>]
 *        the packages kept in ~/.proscenium/store/vX.Y.Z/, held to the hashes
 *        packages.json gives, submitted (scripts/ms-store.mjs)
 *   node scripts/release-ms-store.mjs submit --version X.Y.Z --dry-run [--out <dir>]
 *        a stand-in's: the packages the run's own checkout holds, if any, the archive
 *        and the submission's data made from a submission of the shape Partner Center
 *        returns, and held to their limits; no key is read and nothing is sent
 *   node scripts/release-ms-store.mjs status --submission <id>
 *        certification's answer, as JSON, for the release machine's watch
 *   node scripts/release-ms-store.mjs blocking --version X.Y.Z
 *        whether another submission is in the way of X.Y.Z's, as JSON
 *   node scripts/release-ms-store.mjs material [--check]
 *        whether the build host has the submission key, by name, never a value;
 *        with --check, whether Microsoft Entra accepts it
 *
 * **Waiting, not failing.** Without the key, `submit` says so in its result
 * (`waiting`) and exits 0, as the Mac App Store's build does without its
 * certificates. Another release's submission still in certification, or a
 * draft a person made in Partner Center, is waited for the same way.
 *
 * Writes `<out>/ms-store.json`, the result the release machine records.
 * Nothing here prints a secret: the key goes from the keychain to Microsoft
 * Entra in the one request that asks for a token.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storeNotes } from "./app-store-connect.mjs";
import {
  NOTES_LIMIT,
  apiOf,
  certificationState,
  inFlight,
  msToken,
  packageVersion,
  putOf,
  submitPackages,
  updatedSubmission,
} from "./ms-store.mjs";
import { load } from "./release-keychain.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- what is pure, and tested ---------------------------------------------------------

/** Where the release's `store` stage keeps its packages on the build host. */
export const keptIn = (version, home = homedir()) =>
  join(home, ".proscenium", "store", `v${version}`);

/**
 * What is wrong with the kept packages against `packages.json` (`said`) and
 * the bytes read (`files`, by name): empty when both chips are there, each
 * the bytes packages.json hashed, and of this version.
 */
export function packagesWrong(said, files, version) {
  const wrong = [];
  if (said?.version !== version)
    wrong.push(`packages.json is ${said?.version ?? "no version"}'s, not ${version}'s`);
  const listed = said?.packages ?? [];
  for (const chip of ["x64", "arm64"])
    if (!listed.some((p) => p.chip === chip)) wrong.push(`packages.json names no ${chip} package`);
  for (const p of listed) {
    const bytes = files[p.name];
    if (!bytes) wrong.push(`${p.name} is not there`);
    else if (createHash("sha256").update(bytes).digest("hex") !== p.sha256)
      wrong.push(`${p.name} is not the bytes packages.json hashed`);
  }
  return wrong;
}

/** What the build host lacks for a submission, by name: empty when it has it all. */
export function missingKey(key) {
  const missing = [];
  if (!key.tenantId) missing.push("the Microsoft Store key's tenant ID");
  if (!key.clientId) missing.push("the Microsoft Store key's client ID");
  if (!key.secret) missing.push("the Microsoft Store key's secret");
  return missing;
}

/**
 * A submission as Partner Center's clone of the last published one comes,
 * for a dry run to make its data from: one listing, two packages, a price.
 */
export const SHAPE = {
  id: "0",
  applicationCategory: "Productivity",
  pricing: { trialPeriod: "NoFreeTrial", marketSpecificPricings: {}, sales: [], priceId: "Base" },
  visibility: "Public",
  targetPublishMode: "Immediate",
  listings: { "en-us": { baseListing: { title: "Proscenium: Playwriting", releaseNotes: "" } } },
  applicationPackages: [
    { fileName: "Proscenium_0.0.0_x64.msix", fileStatus: "Uploaded", id: "1", version: "0.0.0.0" },
    {
      fileName: "Proscenium_0.0.0_arm64.msix",
      fileStatus: "Uploaded",
      id: "2",
      version: "0.0.0.0",
    },
  ],
  status: "PendingCommit",
  fileUploadUrl: "https://example.invalid/ingestion",
};

// --- the build host ---------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message) {
  throw new Error(`release-ms-store: ${message}`);
}

function step(what) {
  console.log(`\n── ${what}`);
}

/** The submission key, from the release keychain: each part, or null where it is missing. */
function storeKey() {
  return {
    tenantId: load("MS_STORE_TENANT_ID")?.toString() ?? null,
    clientId: load("MS_STORE_CLIENT_ID")?.toString() ?? null,
    secret: load("MS_STORE_CLIENT_SECRET")?.toString() ?? null,
  };
}

/** This checkout's Store identity: the Store ID Partner Center gave the product. */
function storeId() {
  const said = JSON.parse(
    readFileSync(join(ROOT, "src-tauri/windows/store-identity.json"), "utf8"),
  );
  if (!said.storeId) fail("src-tauri/windows/store-identity.json names no Store ID");
  return said.storeId;
}

/** The release's notes, as the Microsoft Store's What's new. */
function notesOf(version) {
  const said = spawnSync(process.execPath, ["scripts/version.mjs", "notes", version], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const notes = storeNotes(said.status === 0 ? said.stdout : "", { store: "windows" });
  if (!notes) fail(`the changelog has no notes for ${version}: What's new is made from them`);
  return notes;
}

/** The packages as one archive, by name, stored as they are: an MSIX is compressed already. */
function zipOf(packages) {
  const dir = mkdtempSync(join(tmpdir(), "proscenium-msstore-"));
  try {
    for (const p of packages) writeFileSync(join(dir, p.name), p.bytes);
    const r = spawnSync("zip", ["-q", "-X", "-0", "packages.zip", ...packages.map((p) => p.name)], {
      cwd: dir,
      encoding: "utf8",
    });
    if (r.status !== 0) fail(`zip could not make the archive: ${(r.stderr || "").trim()}`);
    return readFileSync(join(dir, "packages.zip"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The kept packages, read and held to packages.json. */
function keptPackages(version) {
  const dir = keptIn(version);
  const file = join(dir, "packages.json");
  if (!existsSync(file))
    fail(`${dir} holds no packages.json: the release's store stage keeps the packages there`);
  const said = JSON.parse(readFileSync(file, "utf8"));
  const files = Object.fromEntries(
    (said.packages ?? [])
      .filter((p) => existsSync(join(dir, p.name)))
      .map((p) => [p.name, readFileSync(join(dir, p.name))]),
  );
  const wrong = packagesWrong(said, files, version);
  if (wrong.length) fail(wrong.join("; "));
  return said.packages.map((p) => ({
    chip: p.chip,
    name: p.name,
    sha256: p.sha256,
    bytes: files[p.name],
  }));
}

/** A stand-in's packages, from its run's own checkout: none is fine, since nothing is sent. */
function standInPackages(version) {
  const dir = join(ROOT, ".release-artifacts", `v${version}`, "store");
  return ["x64", "arm64"]
    .map((chip) => ({ chip, name: `Proscenium_${version}_${chip}.msix` }))
    .filter((p) => existsSync(join(dir, p.name)))
    .map((p) => {
      const bytes = readFileSync(join(dir, p.name));
      return { ...p, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
}

async function submit() {
  const version = opt("--version");
  if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
    fail("--version X.Y.Z: only a stable release goes to the Store");
  const dryRun = args.includes("--dry-run");
  const out = resolve(opt("--out") ?? join(ROOT, ".release-artifacts", `msstore-${version}`));
  mkdirSync(out, { recursive: true });
  const result = (fields) => {
    const doc = { version, packageVersion: packageVersion(version), dryRun, ...fields };
    writeFileSync(join(out, "ms-store.json"), `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  };

  step("What's new, from the release's notes");
  const notes = notesOf(version);
  console.log(`  ${notes.length} of ${NOTES_LIMIT} characters`);
  const id = storeId();

  if (dryRun) {
    step("a dry run: the archive and the submission's data, nothing sent");
    const packages = standInPackages(version);
    const files = packages.length
      ? packages.map((p) => p.name)
      : ["x64", "arm64"].map((chip) => `Proscenium_${version}_${chip}.msix`);
    const archive = packages.length ? zipOf(packages) : null;
    const body = updatedSubmission(SHAPE, { files, notes });
    console.log(
      `  ${packages.length ? `${packages.length} packages in a ${archive.length}-byte archive` : "no packages in this checkout: the data alone"}; ${body.applicationPackages.length} package lines, price ${body.pricing.priceId}`,
    );
    return result({
      state: "dry-run",
      storeId: id,
      notes: notes.length,
      packages: packages.map(({ chip, name, sha256 }) => ({ chip, name, sha256 })),
      archive: archive?.length ?? null,
    });
  }

  step("the packages, held to packages.json");
  const packages = keptPackages(version);
  for (const p of packages)
    console.log(`  ${p.name}: ${p.bytes.length} bytes, sha256 ${p.sha256.slice(0, 12)}`);
  const key = storeKey();
  const missing = missingKey(key);
  if (missing.length) {
    console.log(`  waiting on ${missing.join(", ")}`);
    return result({ state: "waiting", storeId: id, missing, waiting: { on: "key" } });
  }

  step(`${packageVersion(version)}: submitted to Partner Center`);
  const done = await submitPackages({
    api: apiOf(key),
    put: putOf(),
    zip: async (ps) => zipOf(ps),
    storeId: id,
    version,
    packages,
    notes,
  });
  for (const line of done.steps) console.log(`  ${line}`);
  const said = result({
    state: done.waiting ? "waiting" : done.already ? "already" : "submitted",
    storeId: id,
    submission: done.submission ?? null,
    status: done.status ?? null,
    page: done.page,
    waiting: done.waiting ?? null,
    notes: notes.length,
    packages: packages.map(({ chip, name, sha256 }) => ({ chip, name, sha256 })),
  });
  console.log(
    `  ${said.state}${said.submission ? `: submission ${said.submission}, ${said.status}` : ""}`,
  );
}

/** Certification's answer for `--submission`, as JSON on standard output, for the release machine. */
async function status() {
  const key = storeKey();
  const missing = missingKey(key);
  if (missing.length) fail(`the release keychain lacks ${missing.join(", ")}`);
  const submission = opt("--submission");
  if (!/^\d{1,30}$/.test(submission ?? "")) fail("--submission <id>, Partner Center's number");
  console.log(
    JSON.stringify(await certificationState({ api: apiOf(key), storeId: storeId(), submission })),
  );
}

/**
 * Whether another submission is in the way of `--version`'s, as JSON on
 * standard output (`{ blocking }`, null when the way is clear): one still on
 * its way through certification, or a draft a person made in Partner Center.
 */
async function blocking() {
  const key = storeKey();
  const missing = missingKey(key);
  if (missing.length) fail(`the release keychain lacks ${missing.join(", ")}`);
  const version = opt("--version");
  const api = apiOf(key);
  const id = storeId();
  const app = await api("GET", `/v1.0/my/applications/${encodeURIComponent(id)}`);
  if (app.status !== 200) fail(`Partner Center answered ${app.status} for the product`);
  const pending = app.json?.pendingApplicationSubmission?.id;
  if (!pending) return console.log(JSON.stringify({ blocking: null }));
  const s = await api(
    "GET",
    `/v1.0/my/applications/${encodeURIComponent(id)}/submissions/${encodeURIComponent(pending)}`,
  );
  if (s.status !== 200) fail(`Partner Center answered ${s.status} for submission ${pending}`);
  const carries = (s.json?.applicationPackages ?? []).some(
    (p) => p.version === packageVersion(version) && p.fileStatus !== "PendingDelete",
  );
  const status = String(s.json?.status ?? "None");
  const draft = !inFlight(status);
  // This release's own, or a draft its submission removes and makes again.
  if (carries || (draft && s.json?.fileUploadUrl))
    return console.log(JSON.stringify({ blocking: null }));
  console.log(
    JSON.stringify({
      blocking: { on: draft ? "draft" : "submission", submission: pending, status },
    }),
  );
}

async function material() {
  const key = storeKey();
  const missing = missingKey(key);
  console.log(
    missing.length
      ? `missing   ${missing.join("; ")}`
      : "the Microsoft Store's submission key is here",
  );
  if (!missing.length && args.includes("--check")) {
    await msToken(key);
    console.log("Microsoft Entra accepts it");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = args[0];
  const commands = { submit, status, blocking, material };
  if (!commands[command]) {
    console.error(
      "usage: node scripts/release-ms-store.mjs submit --version X.Y.Z [--dry-run] [--out <dir>]\n" +
        "       node scripts/release-ms-store.mjs status --submission <id>\n" +
        "       node scripts/release-ms-store.mjs blocking --version X.Y.Z\n" +
        "       node scripts/release-ms-store.mjs material [--check]",
    );
    process.exit(2);
  }
  try {
    await commands[command]();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
