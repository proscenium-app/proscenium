// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Serve the stand-in with `wrangler dev`, on the address its `UPDATES` var
 * names, from its local state (docs/engineering/services-and-feedback.md#SERV-274):
 *
 *   bun run dev:standin
 *
 * The port is the var's, never Wrangler's default, so rewriting the vars in
 * wrangler.standin.jsonc moves the Worker with its helpers. Wrangler here is
 * local: it is given no token, and every binding is a local one.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { EDGE, listening, STANDIN_CONFIG, STANDIN_STATE, standInConfig } from "./standin.ts";

const { hostname, port } = listening(standInConfig().vars.UPDATES);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^CLOUDFLARE_|^CF_/.test(k)),
);
const r = spawnSync(
  join(EDGE, "node_modules/.bin/wrangler"),
  [
    "dev",
    "--config",
    STANDIN_CONFIG,
    "--persist-to",
    STANDIN_STATE,
    "--ip",
    hostname,
    "--port",
    String(port),
  ],
  { cwd: EDGE, stdio: "inherit", env: { ...env, WRANGLER_SEND_METRICS: "false" } },
);
process.exit(r.status ?? 1);
