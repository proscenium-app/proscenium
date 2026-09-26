// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// The production entry as first deployed: the global fetch handed
// over as a property. workerd refuses the call, and test/workerd.node.ts holds
// that this now answers 500, the Worker's own fault, and never GitHub's 502.
import { updates, UPDATES, type Env } from "../../src/updates";
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return updates(request, env, { fetch, cache: caches.default, now: () => new Date(), updatesOrigin: UPDATES });
  },
} satisfies ExportedHandler<Env>;
