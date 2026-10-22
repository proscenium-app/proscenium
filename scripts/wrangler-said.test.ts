// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { inPassing, wranglerSaid } from "./wrangler-said.mjs";

const LOGS =
  '🪵  Logs were written to "/var/folders/xx/T/proscenium-wrangler-abc/wrangler-2026-09-28_14-58-51_236.log"';

test("wrangler's error line, never the log it names, which is gone when the command returns", () => {
  const missing = `\n\u001b[31m✘ \u001b[41;31m[\u001b[41;97mERROR\u001b[41;31m]\u001b[0m \u001b[1mThe specified key does not exist.\u001b[0m\n\n${LOGS}\n`;
  expect(wranglerSaid(missing)).toBe("✘ [ERROR] The specified key does not exist.");
  const busy = `✘ [ERROR] Failed to fetch /accounts/a/r2/buckets/b/objects/k - 503: Service Unavailable;\n\n  upstream connect error\n\n${LOGS}\n`;
  expect(wranglerSaid(busy)).toBe(
    "✘ [ERROR] Failed to fetch /accounts/a/r2/buckets/b/objects/k - 503: Service Unavailable; upstream connect error",
  );
  expect(wranglerSaid(`${LOGS}\n`, 1)).toBe("wrangler exited 1");
  expect(wranglerSaid("something else went wrong\n")).toBe("something else went wrong");
});

test("a dropped connection, a timeout, a 429 or a 5xx is made again; a missing object or a refusal is not", () => {
  for (const said of [
    "✘ [ERROR] fetch failed",
    "✘ [ERROR] Failed to fetch /accounts/a/r2/buckets/b/objects/k - 503: Service Unavailable;",
    "✘ [ERROR] Failed to fetch /accounts/a/r2/buckets/b/objects/k - 429: Too Many Requests;",
    "✘ [ERROR] Failed to fetch /accounts/a/r2/buckets/b/objects/k - 500: Internal Server Error;",
    "✘ [ERROR] read ECONNRESET",
    "✘ [ERROR] connect ETIMEDOUT 104.19.192.176:443",
    "✘ [ERROR] getaddrinfo EAI_AGAIN api.cloudflare.com",
  ])
    expect(inPassing(said)).toBe(true);
  for (const said of [
    "✘ [ERROR] The specified key does not exist.",
    "✘ [ERROR] Failed to fetch /accounts/a/r2/buckets/b/objects/k - 403: Forbidden;",
    "✘ [ERROR] Failed to fetch /accounts/a/r2/buckets/b/objects/k - 400: Bad Request;",
    "wrangler exited 1",
    "",
  ])
    expect(inPassing(said)).toBe(false);
});
