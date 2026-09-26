// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { connect } from "cloudflare:sockets";
import { counts, expireCounts, REPORTS, type ReportsEnv } from "./reports";
import { crashes, CRASH_PATH, type CrashEnv } from "./crashes";
import { forward } from "./sentry-forward";
import { GO, links } from "./links";
import { updates, UPDATES, type Env as UpdateEnv } from "./updates";
import { feedback, expireFeedback, FEEDBACK, type FeedbackEnv } from "./feedback";
import { patrons, expirePatrons, githubName, PATRONS, type PatronsEnv } from "./patrons";
interface Env extends UpdateEnv, FeedbackEnv, ReportsEnv, CrashEnv, PatronsEnv { LINKS_ENABLED: string }
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).origin === FEEDBACK) return feedback(request, env, { now: () => new Date() });
    const url = new URL(request.url);
    if (url.origin === GO) return Promise.resolve(links(request, env));
    if (url.origin === PATRONS) return patrons(request, env, { now: () => new Date(), displayName: login => githubName(login) });
    if (url.origin === REPORTS) return url.pathname === CRASH_PATH
      ? crashes(request, env, new Date(), (bytes, dsn) => forward(bytes, dsn, (address, options) => connect(address, { ...options, allowHalfOpen: false })))
      : counts(request, env, new Date());
    // Never `{ fetch }`: workerd refuses fetch called as another object's method (test/index.test.ts).
    return updates(request, env, { fetch: r => fetch(r), cache: caches.default, now: () => new Date(), updatesOrigin: UPDATES });
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> { await expireFeedback(env.DB, new Date()); await expireCounts(env.DB, new Date()); await expirePatrons(env.DB, new Date()); },
} satisfies ExportedHandler<Env>;
