// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// Local-only entry. Production index.ts has no environment-controlled upstream.
import { updates, type Env } from "../src/updates";
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return updates(request, env, {
      updatesOrigin: "http://127.0.0.1:8787", cache: caches.default, now: () => new Date(),
      fetch: request => {
        const source = new URL(request.url);
        if (source.hostname !== "github.com") throw new Error("Unexpected rehearsal origin");
        return fetch(new Request(`http://127.0.0.1:8791${source.pathname}`, request));
      },
    });
  },
} satisfies ExportedHandler<Env>;
