// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform !== "darwin") throw new Error("The WebKit socket test requires macOS.");
const root = new URL("../", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "proscenium-webkit-"));
const env = { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" };
async function run(args: string[]) {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${out}\n${err}`);
  return out;
}
try {
  const source = await readFile(join(root, "src-tauri/src/telemetry/allowlist.rs"), "utf8");
  const rules = /pub const WEBVIEW_RULES: &str = r#"([\s\S]*?)"#;/.exec(source)?.[1];
  if (!rules) throw new Error("The app's WebKit rules could not be read.");
  JSON.parse(rules);
  const file = join(directory, "rules.json");
  const binary = join(directory, "probe");
  await writeFile(file, rules);
  const config = JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const csp = Object.entries(config.app.security.csp)
    .map(([key, value]) => `${key} ${value}`)
    .join("; ");
  await run(["swiftc", join(root, "scripts/check-webkit-network.swift"), "-o", binary]);
  for (const mode of ["control", "blocked"]) {
    let accepted = 0;
    const server = createServer((socket) => {
      accepted++;
      socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No TCP test address.");
      const out = await run([binary, file, String(address.port), mode, csp]);
      if (!out.includes("probe inserted"))
        throw new Error("The page never inserted its preconnect probe.");
      if (mode === "control" ? accepted === 0 : accepted !== 0)
        throw new Error(`${mode}: ${accepted} TCP connections`);
      console.log(`WebKit ${mode}: ${accepted} TCP connections`);
    } finally {
      server.close();
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
