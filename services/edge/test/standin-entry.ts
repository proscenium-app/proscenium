// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stand-in's entry, local only (docs/engineering/services-and-feedback.md#SERV-274).
 *
 * The update routes exactly as production answers them, with the origins
 * production keeps as constants (`REPOSITORY`, `GITHUB`, `UPDATES`) read from
 * wrangler.standin.jsonc's vars instead, and the R2 keys read under
 * `stand-in/`: a stand-in release is served on the `UPDATES` origin from a
 * local R2 seeded with its files (test/standin-seed.ts), and its GitHub
 * manifest comes from the loopback GitHub stand-in (test/github-standin.ts
 * --stand-in).
 *
 * On the same origin, production's crash route and feedback route, each on its
 * own path as production serves it on its own host
 * (docs/engineering/services-and-feedback.md#SERV-279): a crash report is taken
 * or refused by the Worker's own lists, as in production, and a taken one is
 * forwarded to the Sentry stand-in (test/sentry-standin.ts) in place of Sentry.
 *
 * Every origin must be loopback, and the only requests it makes are to its
 * GitHub and Sentry stand-ins: anything else throws before it leaves, which
 * answers 500. The production entry, src/index.ts, takes no origin or prefix
 * from its environment and never imports this one.
 */
import { crashes, CRASH_PATH, type CrashEnv } from "../src/crashes";
import { feedback, FEEDBACK, type FeedbackEnv } from "../src/feedback";
import { REPORTS } from "../src/reports";
import { updates, type Env } from "../src/updates";

export interface StandInEnv extends Env, Omit<CrashEnv, "SENTRY_DSN">, FeedbackEnv {
  REPOSITORY: string;
  GITHUB: string;
  UPDATES: string;
  SENTRY: string;
  KEY_PREFIX: string;
}
const LOOPBACK = ["127.0.0.1", "[::1]", "localhost"];
const PREFIX = "stand-in/";

/** The stand-in's origins, held to loopback and to each other as production's constants are. */
export function origins(env: StandInEnv): {
  updatesOrigin: string;
  github: string;
  sentry: string;
} {
  const updatesOrigin = new URL(env.UPDATES);
  const github = new URL(env.GITHUB);
  const sentry = new URL(env.SENTRY);
  if (![updatesOrigin, github, sentry].every((u) => LOOPBACK.includes(u.hostname)))
    throw new Error("A stand-in answers and asks on loopback alone");
  if (updatesOrigin.origin !== env.UPDATES || sentry.origin !== env.SENTRY)
    throw new Error("UPDATES and SENTRY are origins: a scheme, a host and a port");
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(env.REPOSITORY) || github.search || github.hash)
    throw new Error("REPOSITORY is owner/name");
  if (github.href !== `${github.origin}/${env.REPOSITORY}/releases`)
    throw new Error("GITHUB is REPOSITORY's releases, as production's constant is");
  if (env.KEY_PREFIX !== PREFIX) throw new Error(`A stand-in's keys are under ${PREFIX}`);
  return { updatesOrigin: updatesOrigin.origin, github: github.href, sentry: sentry.origin };
}

export default {
  fetch(request: Request, env: StandInEnv): Promise<Response> {
    const { updatesOrigin, github, sentry } = origins(env);
    const log = (line: string) => console.error(line);
    const url = new URL(request.url);
    const post = request.method === "POST" && url.origin === updatesOrigin;
    // Production's crash route, as reports.proscenium.ink answers it.
    if (post && url.pathname === CRASH_PATH)
      return crashes(
        new Request(`${REPORTS}${CRASH_PATH}`, request),
        // The "DSN" is the Sentry stand-in's envelope route, which the forwarder below holds it to.
        { ...env, SENTRY_DSN: `${sentry}/api/1/envelope/` },
        new Date(),
        async (bytes, dsn) => {
          if (new URL(dsn).origin !== sentry)
            throw new Error("A stand-in forwards to its Sentry stand-in alone");
          const r = await fetch(
            new Request(dsn, {
              method: "POST",
              body: bytes,
              headers: { "Content-Type": "application/x-sentry-envelope" },
            }),
          );
          await r.body?.cancel();
          return r.status;
        },
        {
          bucket: env.TRACKS,
          cache: caches.default,
          origin: updatesOrigin,
          prefix: env.KEY_PREFIX,
          log,
        },
      );
    // Production's feedback route, as feedback.proscenium.ink answers it.
    if (post && url.pathname === "/v1/messages")
      return feedback(new Request(`${FEEDBACK}/v1/messages`, request), env, {
        now: () => new Date(),
      });
    return updates(request, env, {
      updatesOrigin,
      github,
      prefix: env.KEY_PREFIX,
      cache: caches.default,
      now: () => new Date(),
      log,
      fetch: (outbound) => {
        if (new URL(outbound.url).origin !== new URL(github).origin)
          throw new Error("A stand-in reaches its GitHub stand-in alone");
        return fetch(outbound);
      },
    });
  },
} satisfies ExportedHandler<StandInEnv>;
