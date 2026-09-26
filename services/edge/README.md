# Proscenium services

T7's Cloudflare Worker. The contract is [service-addresses](../../docs/engineering/services-and-feedback.md).
Production handles only its named hosts, methods and paths. Workers Logs and
preview deployments are disabled. No request headers or addresses enter D1;
daily aggregate update/usage counts and explicit feedback fields do. Rate-limit buckets use the incoming
address transiently, without application logs or persisted identifiers.

## Local proof

From this directory, `bun install --frozen-lockfile`, `bun run typecheck` and
`bun test ./test` check the Worker with an actual SQLite database and bounded
upstream responses. `bunx wrangler deploy --dry-run` bundles the production
entry without contacting an account or deploying anything.

The complete transport rehearsal uses no public repository, account or secret:

1. From the repository root, `node scripts/release.mjs --rehearse`. This builds
   the universal app and DMG and signs the archive with a throwaway updater
   key. Only its public half survives in `rehearsal.pub`.
2. Here, `bunx wrangler d1 migrations apply proscenium-services-local --local
   --config wrangler.local.jsonc`, then `bun run dev`.
3. In another terminal here, `bun test/github-standin.ts`. It serves only the
   rehearsal artifacts, on loopback port 8791. The fallback manifest preserves
   that server as its independent archive source.
4. From the repository root:
   `PROSCENIUM_UPDATE_REHEARSAL="$PWD/.release-artifacts/v0.1.0-rehearsal" cargo
   test --manifest-path src-tauri/Cargo.toml
   worker_and_unreachable_primary_both_install_a_verified_release -- --ignored`.

The native test uses the pinned updater and the app's actual bounded signature
verification and atomic installer. It installs into disposable bundles with no
window and no live Plays folder. It proves both the Worker on port 8787 and an
unreachable first endpoint followed by the independent fallback. The production
entry never imports the local entry or accepts an upstream override. Loopback
transport exists only in test code. A signed, notarized launch and restart on a
real Mac remains a release check.

The local admission list contains 0.0.0 (the test's older copy) and 0.1.0 (the
current rehearsal artifact). Match it to the artifact if the app version changes.

For another rehearsal, stop both local servers before rebuilding. The stand-in
loads its manifest at startup and Wrangler persists the five-minute cache
across restarts. With Wrangler stopped, remove only `.wrangler/state/v3/cache`
before starting it again; keep the local D1 database. Otherwise the updater
correctly refuses a cached signature made with the previous throwaway key.

## Production, each change with the maintainer's separate yes

`wrangler.jsonc` is exactly what is deployed. Each host joins it with its own
approval, together with its rate limit and bindings; nothing is provisioned
implicitly. `node scripts/edge-wrangler.mjs` runs only the reviewed commands:
`whoami`, `d1-create` (refused once an id is recorded), `r2-create` (the
tracks' bucket), `migrate`, `deploy`, and `query <name> <from> <to>` for the
aggregate queries. The token reaches
Wrangler's environment only, Wrangler's debug log goes to a private directory
removed after each command, and Wrangler is the only network tool given it.

- **Deploy token** (filed 2026-09-18): the user API token "Proscenium Worker
  deploy". Account: Workers Scripts Edit and D1 Edit; zone `proscenium.ink`:
  Workers Routes Edit. No IP filter or expiry. It was filled in in the
  maintainer's browser, and the maintainer created and copied it; `node scripts/release-keychain.mjs
  cloudflare` moved it from the clipboard into the login keychain and cleared
  the clipboard. Its value never appeared in a terminal, file or chat. It is
  not the website's `MBP-CF-token`, and the maintainer's scheduled jobs get their own read-only token.
  Once the Worker exists, the Workers permission could be narrowed to it.
- **D1** (2026-09-18): `proscenium-services`, placed in ENAM, id in
  `wrangler.jsonc`, migrations 0001–0003 applied.
- **R2** (not yet made): `proscenium-updates`, bound as `TRACKS`, holds alpha's
  and beta's manifests, version lists and files
  (docs/engineering/services-and-feedback.md#SERV-249). It needs Workers R2 Storage Edit
  added to the deploy token above, the same token, widened rather than
  replaced (docs/engineering/services-and-feedback.md#SERV-251), then `r2-create` and a
  `deploy`, each with the maintainer's yes.
- **Alpha's key:** `/v1/alpha/…` answers only a request whose
  `Proscenium-Track-Key` hashes to the secret `ALPHA_KEY_SHA256`, and is
  otherwise an unknown track's bare 404. The secret is filed only by
  `node scripts/track-key.mjs issue`, which writes the key into the
  maintainer's `settings.json` in the same step. Unset, alpha answers no one.
  `node scripts/edge-wrangler.mjs r2-exposure` confirms the bucket has no r2.dev
  address and no custom domain, so the Worker is the only way in.
- **Admission list:** `["0.9.0"]`, the signed test build cut next. Every
  release adds its version before publication (docs/engineering/release-engineering.md#SHIP-D100, Every release).
- **updates.proscenium.ink** (deployed 2026-09-18, version `5fe432d7`): the
  update and download routes, rate limits 7001 and 7002 (no other Worker on
  this Mac's projects uses rate limiting), and the daily retention job at 04:15
  UTC. workers.dev and preview URLs are off (the workers.dev address answers
  Cloudflare's error 1042), and so is Workers Logs.
- **feedback.proscenium.ink** (2026-09-19, version `ae928efe`): the list, with
  `FEEDBACK_LIMIT` (7003) after migration 0004. No Email Routing: feedback is
  a list.
- **patrons.proscenium.ink** (2026-09-25, version `70ae8e9f`, on the maintainer's
  "deploy workers"): the program's roll (docs/engineering/services-and-feedback.md#SERV-D105),
  after migration 0005. `PATRONS_WEBHOOK_SECRET` was made with `openssl rand
  -hex 32`, filed in the login keychain as `proscenium-patrons-webhook`, and
  piped to `edge-wrangler.mjs secret`; its value never appeared in a terminal,
  file or chat. Checked live: the roll answers the empty program, cacheable
  five minutes; an unsigned event 401; any other path 404; and
  `go.proscenium.ink/support` 302 to proscenium.ink/support. The maintainer added
  GitHub's webhook for the Sponsors listing the same day, pasting the secret;
  its ping was delivered successfully.
- **Next, each with its own yes:** `reports.proscenium.ink` with `EVENTS_LIMIT`
  (7004) and `CRASH_LIMIT` (7005) after Sentry; `go`; and the zone's DNSSEC,
  CAA, HSTS and TLS floor.

Updates cache only a validated GitHub manifest for five minutes. The Worker
serves only a release's canonical universal DMG, archive and signature. GitHub
errors return 502 for the app's independent fallback. Each route has its own
switch. Empty production admission lists admit no check or download.

Primary references: [Worker rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Status

**2026-09-21, production:** crash forwarding is on (Worker version
`90a492ca`) to the configured Sentry project, whose DSN is the Worker secret
`SENTRY_DSN`. A real panic through the app's hook reached Sentry with stack
frames only: no message, path, line, variable, address or IP. Sentry adds a
country and city from the forwarding Cloudflare data centre, which its
scrubbing rules cannot remove; the privacy page says so.

**2026-09-19, production:** `reports.proscenium.ink` and `go.proscenium.ink`
joined (Worker version `f3c8449c`), with usage counts on and crashes off until
Sentry. From outside:
- `GET /v1/events` and unknown paths answer 404;
- an event off the list and an unreleased version answer 400;
- the crash route answers 503.

`go` sends `releases`, `releases/v0.9.0`, `license` and `privacy` to their
fixed targets. An unreleased version, an unknown name and a query string
answer 404. The hand-run `live_usage_counts_reach_the_service` stored one
`app_launched` as that day's total.

**2026-09-19, production:** `feedback.proscenium.ink` joined the deployment
(Worker version `ae928efe`) after migration 0004, as a list with no email
path. From outside: GET, query and `/admin` answer 404; plain text and an
unknown field get 400 with the Worker's reason, and nothing is stored. The
hand-run `live_feedback_reaches_the_list` (release profile) received a
matching 201 for the same message twice, and `query feedback-receipts` shows it
stored once: 38 characters, with email and details.

**2026-09-18, production:** `updates.proscenium.ink` is live on Cloudflare,
from commit `00782c8` (Worker version `5fe432d7`), on the production D1
database. Checked from outside, the same day:
- DNS answers with Cloudflare's addresses. TLS is Cloudflare's Google Trust
  Services certificate for `proscenium.ink` and `*.proscenium.ink`.
- An admitted check (0.9.0, Apple silicon, macOS 26.6) is counted in
  `update_counts`, then answers 502, because GitHub has no release before
  launch. That 502 sends the updater to its GitHub fallback.
- 0.1.0, a missing or impossible macOS version, another platform, a query
  string, POST, an unknown file, an unreleased download, `/` and `/admin` all
  answer 400 or 404 with an empty body. None of them is stored. The failed
  download was not counted.
- On one connection, the check limit answered 429 after 48 uncounted checks,
  which followed 75 others from the same address that minute.
- `query update-use` read back exactly the two verification checks, which
  remain in the 2026-09-18 counts.

Feedback, usage counts, crash forwarding and links are not attached in
production yet.

2026-09-18, earlier: update Worker, schema, tests, app transport and local
end-to-end rehearsal implemented. Feedback, usage batches, crash forwarding and
browser redirects are implemented and tested locally. The real Rust SDK
envelope is a checked cross-language fixture. All 30 Worker tests, typecheck
and the deployment dry run pass. The fresh universal release rehearsal and
native signed-install proof pass through both the Worker and the independent
fallback. App merge gates passed: 1,131 frontend and 206 native tests, Clippy,
static checks, both smoke appearances and the universal build.

The [Mini service-check design](../../docs/engineering/services-and-feedback.md#CHECKS-D101) specifies the checks. Its six
queries are tested against the migrations in read-only SQLite. None of the
maintainer's scheduled jobs or files on the Mini were changed.

## Feedback: a list, not email

Feedback is programmatic, not an email: a list to run analysis on and use
(2026-09-19). The Worker stores each message in the private list
(`feedback_messages`) and sends nothing on. It has no email API, binding or
address, and a test holds it to that.

`POST feedback.proscenium.ink/v1/messages` accepts exactly `id`, `message`, and
optional `email` / `details`. The message limit is 10,000 grapheme clusters;
JSON is capped at 1 MiB before reading and during streaming, and details at
64 KiB. This byte ceiling also bounds hostile combining-character sequences.
All validation precedes D1. A unique submission id is stored once, and only a
successful insert (or a confirmed existing id) receives 201.

Migration `0002_feedback.sql` creates the list, and `0004_feedback_list.sql`
drops the column that recorded an email notice. The scheduled handler removes
messages older than one year each day; the maintainer's scheduled jobs delete
their copies on the same schedule. No public route reads the list, and Worker logs remain off.

Reading it: the maintainer's scheduled jobs pull each completed UTC day with `queries/feedback-list.sql`
and a read-only token ([contract](../../docs/engineering/services-and-feedback.md)).
`edge-wrangler.mjs query` runs only `feedback-counts` and `feedback-receipts`,
which show ids, days, lengths and whether an email or details came, never words
or addresses, so proving receipt never copies a writer's message into a
transcript.

The feedback tests use real local SQLite for the D1 statements, including
idempotency, storage failure, character/byte caps, strict parsing, route
switches, rate limits, retention and the absence of any email path.

## Counts, crashes and links

The reports batch is `{version, platform, arch, os, channel, events}`. The
Worker reads `events.json`; a native test holds its names and every allowed
property value to `telemetry/events.rs` and the public privacy table. Batches
are capped at 25 events / 16 KiB and validated whole before a transactional
D1 batch adds their combinations to `usage_counts`. Original requests and
individual events are not stored. Update and usage totals expire after two
years in the daily retention job. Failed/lost receipts can overcount actions;
there is deliberately no identity to deduplicate people.

`/api/proscenium/envelope/` is a stable logical project alias. The actual
Sentry project and key are in the Worker secret `SENTRY_DSN`, never the app.
The SDK envelope is one event, at most 64 frames / 64 KiB. Unknown fields,
messages, paths, attachments, dumps, source, memory addresses and identity
fields are refused. Native omits `platform` because Sentry defaults to native;
JavaScript says `javascript`. Crash timestamps are UTC midnight, not the
precise local time. Only released app versions and supported systems pass.

The adapter uses a TLS socket to an exact Sentry ingest hostname and an
explicit HTTP header set. Starting `fetch` with fresh headers alone does not
prove visitor-address removal: Cloudflare can add them. Tests inspect every
outbound byte; the live deployment still needs the separate Sentry proof.
Sentry redirects are never followed. No crash body is saved in D1 or logs.

Before enabling `CRASHES_ENABLED`, the maintainer must create the Sentry account, then
approve the project and its settings: Prevent Storing of IP Addresses on;
free plan with verified 30-day retention, quota/spike protection and no paid
overage; no replay, performance collection, source upload or AI features.
Confirm that Workers TLS sockets can reach that project's ingest, send one
synthetic stack through the owned route, and inspect the received event for
absence of user/IP/message/path fields. Keep the route disabled if any check
fails. File the DSN through a private secret input to Wrangler; never print or
put real credentials in commands, code, logs or chat.

`EVENTS_LIMIT` and `CRASH_LIMIT` are 12 and 6 requests per minute per address
per location (namespace IDs 7004/7005, check availability before deployment).
Events and crashes default disabled until approved. Publish
[site-privacy.md](../../docs/site-privacy.md) in the separate website before
enabling automatic reports for distribution. The four `go` names redirect
without a database write, with a per-route switch and no arbitrary target.
