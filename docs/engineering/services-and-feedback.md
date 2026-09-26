# Services

[Engineering](README.md) › Services

This reference covers owned endpoints, service behavior, protection and operational checks. The app-facing [feedback contract](../app/preferences-and-help/feedback.md) has its own page.

[Endpoints](#SERV-D1) · [Service behavior](#SERV-D2) · [Protection](#SERV-D6) · [Readiness](#SERV-D7)

## Requirements

<a id="SERV-D100"></a>

<a id="SERV-1"></a>

**SERV-1** Owned addresses decouple installed copies from replaceable service providers. The independent updater fallback remains the stated exception.

<a id="SERV-D1"></a>

### The addresses

| Address | Asked by | Behind it | Requirement |
|---|---|---| --- |
| `https://updates.proscenium.ink/v1/{{target}}/{{arch}}/{{current_version}}` | the updater, download builds | counts the check; answers with the release's `latest.json`, its archive addresses rewritten to the next row | <a id="SERV-2"></a>SERV-2 |
| `https://updates.proscenium.ink/v1/download/v<version>/<file>` | the updater | streams that file from the GitHub release | <a id="SERV-3"></a>SERV-3 |
| `https://updates.proscenium.ink/v1/stable/{{target}}/{{arch}}/{{current_version}}` | the updater, stable builds with tracks | the same as SERV-2, under the track's name | <a id="SERV-248"></a>SERV-248 |
| `https://updates.proscenium.ink/v1/<track>/{{target}}/{{arch}}/{{current_version}}` | the updater, `alpha` and `beta` builds | counts the check; answers with that track's manifest from R2 ([SERV-249](#SERV-249)); alpha only with its key ([SERV-261](#SERV-261)) | <a id="SERV-246"></a>SERV-246 |
| `https://updates.proscenium.ink/v1/<track>/download/v<version>/<file>` | the updater | streams that file from the track's R2 objects; alpha only with its key | <a id="SERV-247"></a>SERV-247 |
| `https://reports.proscenium.ink/v1/events` | the reports client | checks each event against the list, then adds it to the day's counts | <a id="SERV-4"></a>SERV-4 |
| `https://reports.proscenium.ink/api/<project>/envelope/` | the crash reporter (Sentry's SDK) | forwards the report to Sentry without the sender's address | <a id="SERV-5"></a>SERV-5 |
| `https://feedback.proscenium.ink/v1/messages` | Send Feedback ([feedback.md](../app/preferences-and-help/feedback.md)) | adds the message to the private list, and sends nothing on | <a id="SERV-6"></a>SERV-6 |
| `https://go.proscenium.ink/<name>` | the writer's browser, from a link in the app | redirects: `releases`, `releases/v<version>`, `license`, `privacy`, `support` | <a id="SERV-7"></a>SERV-7 |
| `https://patrons.proscenium.ink/v1/github` | GitHub, for the Sponsors listing's webhook | records a signed `sponsorship` event in the program's roll (SERV-D105) | <a id="SERV-252"></a>SERV-252 |
| `https://patrons.proscenium.ink/v1/roll` | a release build, and the website's support page | the roll: public names by level and a count of private sponsors | <a id="SERV-253"></a>SERV-253 |

- <a id="SERV-8"></a> **SERV-8** **One exception, on purpose.** The updater's second endpoint stays GitHub's
  own `latest.json`, and the GitHub hosts stay on the allowlist for it.
  - <a id="SERV-9"></a> **SERV-9** tauri-plugin-updater tries its endpoints in order and stops at the first
    that answers (2.11.0, `src/updater.rs`).
  - <a id="SERV-10"></a> **SERV-10** If proscenium.ink ever fails, copies still update from GitHub. If
    Proscenium ever leaves GitHub, the fallback fails quietly and the first
    endpoint carries on.
  - <a id="SERV-11"></a> **SERV-11** A copy that cannot update cannot be fixed, so the one address outside our
    domain is the one that guards against that.
- <a id="SERV-12"></a> **SERV-12** **Versioned paths.** `/v1/` lets a later protocol live beside this one while
  old copies keep speaking v1.
- <a id="SERV-13"></a> **SERV-13** **What the update check carries:** the three values the updater fills into
  the address (platform, architecture, current version), and one header set in
  updates.rs, `Proscenium-OS: <major>.<minor>`, such as `14.6`. Nothing else.
  Those four values are decision 2's count of copies.
  - <a id="SERV-261"></a> **SERV-261** **One more header, on alpha only.** A copy on alpha adds
    `Proscenium-Track-Key` to alpha's check and download, and to nothing else. Alpha
    answers only when the key's SHA-256 is the Worker secret `ALPHA_KEY_SHA256`, and
    otherwise returns an unknown track's bare 404. The key is not counted, stored or
    logged: the Worker compares digests, and its logs stay off.
- <a id="SERV-14"></a> **SERV-14** **Feedback has a host of its own.** A writer who blocks usage reports in a
  firewall can still write to us, and Send Feedback works with reports
  switched off.
- <a id="SERV-15"></a> **SERV-15** **Report a Problem's GitHub handoff goes.** It needed a GitHub account,
  which most playwrights don't have. Send Feedback takes its place, and
  `NEW_ISSUE` leaves the allowlist. Developers still file issues on the
  repository directly.
- <a id="SERV-16"></a> **SERV-16** **Outside this spec,** because they are not built into the app: the website's
  download links and the Homebrew cask. They change with each release and can
  point anywhere.

<a id="SERV-D2"></a>

### The service behind them

<a id="SERV-17"></a>

**SERV-17** One Cloudflare Worker answers on the four owned subdomains.

- <a id="SERV-18"></a> **SERV-18** **Its code lives in this repository,** in `services/edge/`: TypeScript,
  tested with `bun test`, deployed with `wrangler`. It goes public with the
  rest at launch, so anyone can read exactly what is kept.
- <a id="SERV-19"></a> **SERV-19** **Updates.**
  - <a id="SERV-20"></a> **SERV-20** For each check, add one to the day's count for its platform,
    architecture, version and macOS version. Then answer with the current
    release's `latest.json` from GitHub, cached at the edge for five minutes,
    with every `url` rewritten to `/v1/download/…`.
  - <a id="SERV-21"></a> **SERV-21** For each download, stream the file from the GitHub release the path names,
    and count it by version. Only the release's own files are served: the DMG,
    the update archive and its `.sig`.
  - <a id="SERV-22"></a> **SERV-22** When GitHub cannot be reached, answer 502. The updater then tries its
    second endpoint.
  - <a id="SERV-249"></a> **SERV-249** For `alpha` and `beta`, count each check the same way, then answer
    with the track's manifest from R2, cached at the edge for a minute. Downloads come
    from the same bucket, only of a version on the track's list and only its own
    three files. Publishing to either track writes R2 and needs no Worker deploy;
    stable keeps its admission list, its GitHub releases and its fallback.
- <a id="SERV-23"></a> **SERV-23** **Usage counts** (decision 2).
  - <a id="SERV-24"></a> **SERV-24** A batch carries the build's version, platform, architecture, macOS version
    and channel, and a list of events, each a name and its properties.
  - <a id="SERV-25"></a> **SERV-25** Each event must match the event list exactly: the names and property values
    in `src-tauri/src/telemetry/events.rs`. The Worker imports that list as a
    JSON file, and a Rust test holds the file to the enum, so the two cannot
    drift.
  - <a id="SERV-26"></a> **SERV-26** A batch holding anything else is refused whole, with a 400.
  - <a id="SERV-27"></a> **SERV-27** Each event adds one to that day's count for its combination. Nothing else
    is stored: no session id, no time finer than the day it arrives, and no
    address.
- <a id="SERV-28"></a> **SERV-28** **Crash reports** (decision 3). The Worker passes the Sentry envelope on to
  Sentry's ingest for our project, and nothing else, without the sender's
  address or any forwarding header. The Sentry project's "Prevent Storing of IP
  Addresses" setting is on.
  - <a id="SERV-29"></a> **SERV-29** What a report may hold is privacy-and-telemetry.md's to say, with one rule
    fixed here, because it is what keeps "we never touch your writing" true
    through a crash.
  - <a id="SERV-30"></a> **SERV-30** A report is stack traces, never a memory dump (no minidump), since memory
    can hold a play's words.
  - <a id="SERV-31"></a> **SERV-31** It carries no message text and no file path, since either can name a play.
- <a id="SERV-32"></a> **SERV-32** **Feedback** (decision 7, [feedback.md](../app/preferences-and-help/feedback.md)).
  - <a id="SERV-33"></a> **SERV-33** A message carries a submission id and the writer's text. It carries an
    email and technical details only when the writer gave them, and nothing
    else, not even the app version.
  - <a id="SERV-34"></a> **SERV-34** The Worker checks the sizes, a well-formed email if there is one, and that
    no other field is present.
  - <a id="SERV-35"></a> **SERV-35** It stores the message in a private table, then answers 201 with the id.
    That answer is the "confirmed receipt" the sheet waits for.
  - <a id="SERV-36"></a> **SERV-36** The same id again answers the same 201 and stores nothing new, so a retry
    after a lost answer never makes a duplicate.
  - <a id="SERV-37"></a> **SERV-37** **The list is the inbox**. Nothing is emailed or
    forwarded: the Worker has no email binding, and there is no notice
    address. The maintainer's scheduled jobs pull each completed day's messages
    into a private copy of the list on the Mini, where they are reviewed and analysed.
  - <a id="SERV-38"></a> **SERV-38** Replying is an ordinary email to the address the writer gave.
- <a id="SERV-39"></a> **SERV-39** **Links:** redirects (302), and nothing else.
- <a id="SERV-40"></a> **SERV-40** **What it keeps:** the daily counts and the feedback messages, and nothing
  about any single request.
  - <a id="SERV-41"></a> **SERV-41** Workers Logs stays off, and the Worker writes no log line of its own.
  - <a id="SERV-42"></a> **SERV-42** Rate limiting reads the sender's address in memory and forgets it.
- <a id="SERV-43"></a> **SERV-43** **Reading it.** The maintainer's scheduled jobs on the Mac mini pull the counts
  daily with a read-only Cloudflare token, and send the maintainer a weekly summary:
  - <a id="SERV-44"></a> **SERV-44** copies in use by version, macOS version and chip. This is roughly the
    number of copies, since a copy opened twice in a day checks twice;
  - <a id="SERV-45"></a> **SERV-45** each feature's share of launches;
  - <a id="SERV-46"></a> **SERV-46** Sentry's top crashes;
  - <a id="SERV-47"></a> **SERV-47** how many feedback messages arrived.

  The same daily job copies new feedback into the maintainer's private list, which it
  deletes after a year, as the Worker does. Nothing on the Mini is reachable
  from the internet.

<a id="SERV-D3"></a>

### What we count, and why, in public

<a id="SERV-48"></a>

**SERV-48** Decision 5. A writer should be able to read, in one place, everything
Proscenium sends and the reason for each piece.

- <a id="SERV-49"></a> **SERV-49** **No reason, no field.** Every event, property and crash-report field
  appears on the privacy page with the reason it is collected, in a writer's
  words. Anything without a reason is not collected.
- <a id="SERV-50"></a> **SERV-50** **The page cannot promise less than the app sends.** The table is generated
  from, or held by a test to, `events.rs` and the Worker's event list.
- <a id="SERV-51"></a> **SERV-51** **The page also says** what is never collected, what the switch turns off,
  and where each kind of data goes and for how long.
- <a id="SERV-52"></a> **SERV-52** **Where it appears:** docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D7 and the site's privacy
  page. Settings › Privacy links to the site's page.

<a id="SERV-53"></a>

**SERV-53** The complete public field-and-reason table is now in
[docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D7](../app/keeping-work/privacy-and-telemetry.md#PRIV-D7)
and the tested publishing copy [site-privacy.md](../site-privacy.md). The compact
index below links the decisions to that complete inventory:

| What is sent | With it | Why | Requirement |
|---|---|---| --- |
| Each update check | platform, chip, app version, macOS version | how many copies are in use, and on what | <a id="SERV-54"></a>SERV-54 |
| Every batch of usage counts | app version, macOS version, chip, and channel (download or store) | which versions and systems to keep supporting, and when an older one can be dropped | <a id="SERV-55"></a>SERV-55 |
| `app_launched` | — | how many times the app is opened each day | <a id="SERV-56"></a>SERV-56 |
| `play_opened` | how many plays are in the folder: 1, 2–5, 6–20, 21+ | whether writers keep one play or many, which shapes the Plays screen | <a id="SERV-57"></a>SERV-57 |
| `surface_shown` | which one: script, board, outline, cast, changes, format designer; each at most once a launch | which parts of the app earn their place, and which need work | <a id="SERV-58"></a>SERV-58 |
| `pdf_exported` | whole, range or sides; which built-in format, or "your own" | which exports matter most, and which formats to perfect first | <a id="SERV-59"></a>SERV-59 |
| `format_saved` | — | whether writers make their own formats, so whether the designer deserves more work | <a id="SERV-60"></a>SERV-60 |
| `update_installed` | the version it came from and went to | whether updates arrive, and how far behind copies fall | <a id="SERV-61"></a>SERV-61 |
| `error_shown` | the error's code | which errors writers actually meet, so the common ones are fixed first | <a id="SERV-62"></a>SERV-62 |
| A crash report | where in the code it failed (stack traces), the kind of failure, app version, macOS version, chip | to find the crash and fix it | <a id="SERV-63"></a>SERV-63 |
| A feedback message | your words; your email and the technical details only if you add them | so you can tell us anything, and we can answer | <a id="SERV-64"></a>SERV-64 |

- <a id="SERV-65"></a> **SERV-65** **Never collected automatically:** anything you write or name. That means a play's text,
  titles, character names, and file or folder names or paths.
- <a id="SERV-66"></a> **SERV-66** **Also never collected:** exact counts; error or crash message text; the
  contents of memory; your IP address; your Mac's name or any identifier; and
  anything that ties a count to you.
- <a id="SERV-67"></a> **SERV-67** `crash_reported` leaves the event list, because crash reports take its place.

<a id="SERV-D4"></a>

### In the app

- <a id="SERV-68"></a> **SERV-68** **`allowlist.rs`:**
  - <a id="SERV-69"></a> **SERV-69** `CONTACTED_HOSTS` becomes `updates.proscenium.ink`,
    `reports.proscenium.ink`, `feedback.proscenium.ink`, and the three GitHub
    hosts for the fallback. `eu.aptabase.com` goes.
  - <a id="SERV-70"></a> **SERV-70** `RELEASES` and `LICENSE` become `go.proscenium.ink` links, and `NEW_ISSUE`
    goes.
  - <a id="SERV-71"></a> **SERV-71** Its tests hold the new list.
- <a id="SERV-72"></a> **SERV-72** **`update_url_allowed`:** the updates host, plus the GitHub hosts for the
  fallback path only. The updates host serves downloads itself, so a download
  from it follows no redirect.
- <a id="SERV-73"></a> **SERV-73** **`tauri.conf.json`:** `endpoints` holds the templated address, then GitHub's
  `latest.json`.
- <a id="SERV-74"></a> **SERV-74** **`updates.rs`:** sends `Proscenium-OS` with each check.
- <a id="SERV-75"></a> **SERV-75** **`client.rs`:**
  - <a id="SERV-76"></a> **SERV-76** Speaks the Worker's batch format in place of Aptabase's.
  - <a id="SERV-77"></a> **SERV-77** The build-time key goes. Release builds switch reports on with a build flag
    that `release.mjs` sets, and every other build still sends nothing.
  - <a id="SERV-78"></a> **SERV-78** `release-keychain.mjs analytics` and the `PROSCENIUM_ANALYTICS_KEY` item go
    with it.
- <a id="SERV-79"></a> **SERV-79** **Send Feedback:** its own client in Rust ([feedback.md](../app/preferences-and-help/feedback.md)),
  independent of the reports switch.
- <a id="SERV-80"></a> **SERV-80** **`release.mjs`:**
  - <a id="SERV-81"></a> **SERV-81** Reads the repository from the GitHub endpoint, now the second.
  - <a id="SERV-82"></a> **SERV-82** Keeps writing GitHub addresses into `latest.json`, so the fallback works on
    its own.
- <a id="SERV-83"></a> **SERV-83** **`check:network` is unchanged:** `allowlist.rs` stays the one place an
  address may be written.

<a id="SERV-D5"></a>

### The other platforms

- <a id="SERV-84"></a> **SERV-84** A Windows download build uses the same addresses; the updater fills in
  `windows` for the platform.
- <a id="SERV-85"></a> **SERV-85** Store builds (Mac App Store, iOS, Android, Microsoft Store) have no updater.
  They send usage counts, crash reports and feedback to the same addresses, and
  the stores add their own install and crash numbers, free.
- <a id="SERV-86"></a> **SERV-86** A new platform adds nothing to the allowlist.

<a id="SERV-D6"></a>

### Protection

<a id="SERV-87"></a>

**SERV-87** Decision 6. The addresses are public by design: they sit inside every copy,
and nothing in the app is a secret. So everything is checked at the edge, and
nothing a stranger sends can reach a writer's Mac. Updates are still verified
against the updater key, whoever answers.

<a id="SERV-88"></a>

**SERV-88** **The domain.** If it lapsed, every copy would lose its reports and fall back
to GitHub for updates, and whoever registered it next would receive the
reports.
- <a id="SERV-89"></a> **SERV-89** Registration renewed years ahead (Cloudflare Registrar allows up to ten),
  with auto-renew on.
- <a id="SERV-90"></a> **SERV-90** The transfer lock stays on (it is on now).
- <a id="SERV-91"></a> **SERV-91** Two-factor sign-in on the Cloudflare account.
- <a id="SERV-92"></a> **SERV-92** **DNSSEC** is on, so answers for proscenium.ink cannot be forged.
- <a id="SERV-93"></a> **SERV-93** **CAA records** name only the certificate authorities Cloudflare uses, so no
  one else can obtain a certificate for the domain.
- <a id="SERV-94"></a> **SERV-94** **HTTPS only:** Always Use HTTPS, HSTS, and TLS 1.2 at least. The app refuses
  plain HTTP anyway.

<a id="SERV-95"></a>

**SERV-95** **At the edge.**
- <a id="SERV-96"></a> **SERV-96** All four hosts are proxied, so Cloudflare's DDoS protection covers them.
- <a id="SERV-97"></a> **SERV-97** **Rate limits** per route: generous for update checks (a copy checks about
  daily), tight for usage counts and crash reports, and tighter for feedback.
- <a id="SERV-98"></a> **SERV-98** Only the documented paths and methods answer. Everything else gets a bare
  404, and no admin page or listing is reachable on a public host.

<a id="SERV-99"></a>

**SERV-99** **In the Worker.**
- <a id="SERV-100"></a> **SERV-100** **Size caps** per route, checked before a body is read: an event batch, a
  crash envelope, and a feedback message of 10,000 characters and its details.
- <a id="SERV-101"></a> **SERV-101** **Strict parsing:**
  - <a id="SERV-102"></a> **SERV-102** events exactly on the list;
  - <a id="SERV-103"></a> **SERV-103** feedback as plain text within the limit, with no field it does not
    expect;
  - <a id="SERV-104"></a> **SERV-104** crash envelopes only for our Sentry project;
  - <a id="SERV-105"></a> **SERV-105** downloads only of the release's own files, from our repository.
- <a id="SERV-106"></a> **SERV-106** **Plausibility:** a version never released, or a platform we do not build,
  is refused.
  - <a id="SERV-250"></a> **SERV-250** A version counts as released when the stable admission list or any
    track's list of published versions holds it, so a copy that changes track is
    never refused for the track it came from.
- <a id="SERV-107"></a> **SERV-107** **Secrets** live in Worker secrets, never in the app or the repository: the
  Sentry forwarding target.
  - <a id="SERV-262"></a> **SERV-262** And alpha's key, as its SHA-256 only (`ALPHA_KEY_SHA256`). The key itself
    is in the settings of the copy that holds it, and nowhere in the repository.
- <a id="SERV-108"></a> **SERV-108** **A switch per route.** Any route can be turned off at the edge without an
  app update, for example during a flood of junk feedback. The app then tells
  the writer to try later, and keeps their words.

<a id="SERV-109"></a>

**SERV-109** **Accounts and tokens.**
- <a id="SERV-251"></a> **SERV-251** One deploy token: the Cloudflare token already filed in the login
  keychain and the build host's keychain like the signing material
  (`release-keychain.mjs`), with Workers on this zone, D1 and R2. No second token and no
  narrower one, because the build host is trusted as far as this Mac (the
  maintainer, 2026-09-22). It is used only by `wrangler`.
- <a id="SERV-111"></a> **SERV-111** The scheduled jobs' token, on the Mini, is read-only.
- <a id="SERV-112"></a> **SERV-112** Feedback is readable only through the maintainer's Cloudflare account, the
  scheduled jobs' read-only token and their copy of the list on the Mini.

<a id="SERV-113"></a>

**SERV-113** **Spending.**
- <a id="SERV-114"></a> **SERV-114** Stays on the free tiers at the expected scale of up to 20,000 writers a month: Workers and D1 are free to 100,000 requests and rows written a day, and Sentry to 5,000 errors a month.
- <a id="SERV-115"></a> **SERV-115** If Workers Paid is ever needed, Cloudflare's billing notifications are on.
- <a id="SERV-116"></a> **SERV-116** Sentry's quota and spike protection cap a crash storm: past the quota,
  reports are dropped, never billed.

<a id="SERV-117"></a>

**SERV-117** **Watching.** The maintainer's scheduled jobs check daily:
- <a id="SERV-118"></a> **SERV-118** the first update endpoint answers, and names the same version as GitHub's
  `latest.json`;
- <a id="SERV-119"></a> **SERV-119** its archive downloads, with a valid signature;
- <a id="SERV-120"></a> **SERV-120** usage counts, crash reports and feedback stay near their normal volume.

<a id="SERV-121"></a>

**SERV-121** The maintainer hears the same day if any of these fails.

<a id="SERV-D7"></a>

### Release readiness

1. <a id="SERV-122"></a> **SERV-122** **Before any copy leaves this Mac.** This includes the 0.9.0 test build,
   because launch day updates it through the real address.
   - <a id="SERV-123"></a> **SERV-123** The Worker's update routes are live.
   - <a id="SERV-124"></a> **SERV-124** The app's addresses (docs/engineering/services-and-feedback.md#SERV-D4) are built and tested.
2. <a id="SERV-125"></a> **SERV-125** **Before 1.0:**
   - <a id="SERV-126"></a> **SERV-126** the feedback route, the inbox and the sheet;
   - <a id="SERV-127"></a> **SERV-127** usage counts and crash reports, with privacy-and-telemetry.md revised for
     decisions 2, 3 and 5;
   - <a id="SERV-128"></a> **SERV-128** the protections in docs/engineering/services-and-feedback.md#SERV-D6.

   The app already holds these addresses, so a copy built before a route goes
   live loses only what that route receives. The sheet says so, and keeps the
   writer's words.
3. <a id="SERV-260"></a> **SERV-260** **Launch day.** The Stable update proof
   ([release-engineering.md#SHIP-D104](release-engineering.md#SHIP-D104), step 8) updates a copy of the last
   0.9.x to 1.0.0 through `updates.proscenium.ink`. The updater's way to GitHub
   with that host unreachable is proven by its native tests and the rehearsal
   that ran it headless. It
   replaces SERV-129 (docs/engineering/withdrawn-requirements.md#SERV-129), which
   a person ran on a second macOS account.

<a id="SERV-D105"></a>

### The program's roll

Proscenium's GitHub sponsors, by level, for Settings › About
(docs/app/preferences-and-help/settings.md#SET-32) and proscenium.ink/support (the maintainer,
2026-09-25).

- <a id="SERV-254"></a> **SERV-254** **GitHub's webhook is the only writer.** The Sponsors listing for
  `proscenium-app` posts each `sponsorship` event to SERV-252. The Worker takes it only with a
  valid `X-Hub-Signature-256` for the shared secret `PATRONS_WEBHOOK_SECRET` (a Worker secret,
  32 random bytes as hex), and only for that listing. No GitHub token exists for this: the roll
  starts empty, at the listing's approval, and events carry everything it needs.
- <a id="SERV-255"></a> **SERV-255** **Actions.** `created`, `tier_changed` and `edited` set a sponsor's row;
  `cancelled` deletes it; the `pending_` actions change nothing until they take effect.
- <a id="SERV-256"></a> **SERV-256** **What is stored** (D1 table `patrons`, migration 0005): a SHA-256
  digest of the sponsor's login as the key, the public display name or NULL for a private
  sponsor, the monthly amount, whether it was one-time, and the day. A private sponsor's login and
  name are never stored. A display name the event does not carry is read once from the sponsor's
  public GitHub profile, and cleaned of control and formatting characters, at most 100.
- <a id="SERV-257"></a> **SERV-257** **Levels** follow the tiers' prices, custom amounts included: $25 a
  month or more is a Benefactor, $10 or more a Patron, below that a Friend of the House.
- <a id="SERV-258"></a> **SERV-258** **A one-time gift stays a year** from its day, then the daily job
  deletes it. A monthly sponsor's row goes with GitHub's cancellation.
- <a id="SERV-259"></a> **SERV-259** **The roll** (SERV-253) is `{version: 1, updated, benefactors,
  patrons, friends, private}`: names alphabetical, no logins or addresses, cacheable for five
  minutes. `PATRONS_ENABLED` switches both routes off (503).

<a id="SERV-D102"></a>

### Acceptance

- <a id="SERV-130"></a> **SERV-130** **Updates:** a release copy's first update connection goes to
  `updates.proscenium.ink`. With that host blocked, the copy updates from
  GitHub.
- <a id="SERV-131"></a> **SERV-131** **Allowlist:** its test names exactly the hosts in docs/engineering/services-and-feedback.md#SERV-D1, and `check:network` is
  green.
- <a id="SERV-132"></a> **SERV-132** **The Worker's tests** pass for each of these:
  - <a id="SERV-133"></a> **SERV-133** a check is counted, and its address is not stored;
  - <a id="SERV-134"></a> **SERV-134** an event off the list is refused;
  - <a id="SERV-135"></a> **SERV-135** a batch becomes counts;
  - <a id="SERV-136"></a> **SERV-136** a crash envelope reaches Sentry with no sender address;
  - <a id="SERV-137"></a> **SERV-137** a feedback message is stored once however often it is retried;
  - <a id="SERV-138"></a> **SERV-138** each link redirects;
  - <a id="SERV-139"></a> **SERV-139** an unknown path gets a bare 404, and an oversized body is refused unread.
  - <a id="SERV-245"></a> **SERV-245** each track answers a check from its own manifest; a version on no
    list is refused; a download of another track's file, or of an unpublished
    version, is refused; an unknown track gets a bare 404; and every stable route
    answers exactly as before.
  - <a id="SERV-263"></a> **SERV-263** alpha without its key, or with a wrong one, is an unknown track's bare
    404 before any switch or limit answers; with it, alpha answers; beta and stable
    need none; and no other route tells published alphas apart.
- <a id="SERV-140"></a> **SERV-140** **Feedback:** a message sent from a release build is stored in the list, and
  a reply to the address the writer gave reaches it.
- <a id="SERV-141"></a> **SERV-141** **The zone:** DNSSEC, CAA, HSTS and the rate limits are on, and the scheduled jobs'
  first daily check and weekly summary arrive.
- <a id="SERV-142"></a> **SERV-142** **The privacy page** carries docs/engineering/services-and-feedback.md#SERV-D3's table in full, and [the privacy facts](../app/keeping-work/privacy-and-telemetry.md#PRIV-D7) matches it.


### Data retention and country counts

<a id="SERV-143"></a>

**SERV-143** Countries are not counted. Feedback is kept for a year, then deleted; the privacy page states the retention period.

## Design

`services/edge/` is the Cloudflare Worker, with schema validation, durable aggregate counts and the private feedback list. Native clients consume the centralized allowlist. Update traffic has an independent fallback; reports and manual feedback retain separate consent rules.

<a id="CHECKS-D100"></a>

### Service checks on the Mac mini

The Mini performs deterministic service checks and maintains a private feedback list. Its scheduling and notifications belong to the maintainer's existing scheduled jobs.

<a id="CHECKS-D101"></a>

### Two deterministic jobs

Read the scheduled jobs' generated context, shared-service contract and current
job list first. Extend their scheduler and existing notification path;
do not add a LaunchAgent or expose a server. These jobs use TypeScript/Bun,
fixed queries and templates. No model calls, AI summaries, automatic replies,
issue edits or autonomous repairs. Feedback is untrusted plain text.

- **Daily at 07:15 America/New_York:** service proof, yesterday's complete UTC
  counts, the feedback list pull and volume checks. Notify the maintainer the same day
  about failures. Stay quiet when healthy and unchanged.
- **Monday at 07:30 America/New_York:** one weekly summary to the maintainer's existing
  private destination. Use the preceding seven complete UTC days and the
  preceding seven for comparison. Label those dates. Never send to a writer.

Daily update proof fetches both chip manifests from the first endpoint with a
real admitted version and the Mini's major/minor OS header. Compare the version
and signatures with GitHub's independent latest.json. Download the universal
archive through the owned address, cap it at 512 MiB and verify its Minisign
signature with the public updater key pinned from the reviewed release config.
Do not trust a replacement key from the response. Never launch or install the
archive. Use bounded private temporary files and the existing cleanup helper.
Check HTTPS and exact allowed redirects using the app's transport rules.
The two checks and one archive request enter the public totals; label these
known monitor requests rather than presenting all requests as distinct copies.

Before launch there is no GitHub repository. Keep the comparison/archive job in
an explicit prelaunch state until the maintainer's launch transition supplies that public
release. A missing upstream then is recorded as not yet available, not a fake
successful release check. Once enabled, a 502, version mismatch, broken
signature or unexpected redirect is actionable. Do not silently fall back when
checking the health of the primary service.

A failed network check gets one retry within five minutes. A bad signature
alerts immediately. Repeated failure goes to the existing failure bus and
the maintainer's private notification path, with this job excluded from model-based
repair. Use an idempotent incident key, alert on change/recovery, and remind at
most daily while unresolved. An API error or missing credential means
**unavailable**, never zero. Do not fabricate success from yesterday's data.

<a id="CHECKS-D102"></a>

### Queries and credentials

The SQL files in [services/edge/queries](../services/edge/queries/) are read-only
and tested against the actual migrations. Bind parameters; do not interpolate.
Dates are UTC `YYYY-MM-DD`, with start inclusive and end exclusive.

| Query | Parameters | Use |
|---|---|---|
| `update-use.sql` | start, end | Checks by version, macOS, chip and day; approximate copies in use |
| `downloads.sql` | start, end | Release download requests, not completed installations |
| `feature-share.sql` | start, end | Event/property counts and actions per 100 launches, by channel |
| `daily-volume.sql` | start, end | Daily usage, update and feedback totals for comparisons |
| `feedback-counts.sql` | start, end | Messages per day; no message text |
| `feedback-receipts.sql` | start, end | Per-message receipts (id, day, length, whether an email or details came) with no words or address; safe to show |
| `feedback-list.sql` | cursor day, cursor id, today | The private pull: id, day, message, email, details; 100 rows a page, completed days only; start with empty cursors |

Use Cloudflare's D1 query API with a separate **D1 Read** token, never the
Worker deploy token. Fix the account/database IDs in the reviewed Mini config.
The query API accepts D1 Read. Reject any response with `success: false`, errors
or missing results. Verify read-only permissions in the dashboard; do not try a
write against production as a permission test.
[Cloudflare query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).

Sentry reads use the project's actual regional API origin and a separate token
with `event:read`, `project:read`, and `org:read` only for organization outcome
stats. No DSN or ingest key is needed on the Mini. Configure exact organization
and project IDs. These are the requests to implement with encoded parameters:

- `GET /api/0/organizations/{org}/issues/`: `project={project}`, `start={start}`,
  `end={end}`, `query=issue.category:error`, `sort=freq`, `limit=5`,
  `shortIdLookup=0`, `groupStatsPeriod=auto`. Keep only issue ID, closed failure
  kind, safe code location, period count and permalink. Verify the API's period
  count against its interval series before labeling a number as weekly; never
  substitute a lifetime count. Ignore user counts. If the plan omits the period
  count, show the ranked issues and say the count is unavailable.
  [Issue query](https://docs.sentry.io/api/events/list-an-organizations-issues/).
- `GET /api/0/projects/{org}/{project}/stats/`: `stat=received`, `since={startUnix}`,
  `until={endUnix}`, `resolution=1d`. Sum only bins in the requested window.
  [Project event counts](https://docs.sentry.io/api/projects/retrieve-event-counts-for-a-project/).
- `GET /api/0/organizations/{org}/stats_v2/`: `project={project}`,
  `category=error`, `field=sum(quantity)`, `groupBy=outcome`, `interval=1d`,
  `start={start}`, `end={end minus one second}` (this API's end is inclusive).
  Surface invalid, filtered and rate-limited reports separately from accepted
  crashes. Do not broaden token permissions if a free-plan endpoint is absent;
  report that part unavailable and ask in the Mini session.
  [Outcome counts](https://docs.sentry.io/api/organizations/retrieve-event-counts-for-an-organization-v2/).

The maintainer creates accounts and approves credentials/settings. Never read, display,
type or log token values. Transfer them privately into the login keychain as
the maintainer required; runtime code consumes them without returning values to a task.
Test unattended Mini access before scheduling. If its existing headless secret
store is required instead, ask the maintainer for that storage decision in the Mini
session; do not silently copy credentials into an environment file. Neither
job puts a token, a feedback message or a crash body into this repository or a
model prompt.

<a id="CHECKS-D103"></a>

### What the reports say

Weekly: update checks by version/macOS/chip; downloads; launches; each surface's
share of launches; export kinds/formats, format saves, updates installed and
error codes; top crashes and accepted/dropped totals; feedback counts. Render zeros for known features from `events.json` only when collection
was available for the complete period. A zero denominator is unavailable, not
0%. Actions can exceed 100 per 100 launches. Off-switches, offline queues,
retries and public endpoint abuse limit the inference. Never call these
people, unique users, or a population crash rate.

Daily volume defaults: after seven complete baseline days, flag a total above
three times its trailing-seven-day median **and** at least 50 above it; flag
zero launches when that median was at least 20. Flag any rejected/invalid crash.
During the first week, report observations without an invented baseline.
Settings and thresholds belong to the Mini config.

**The feedback list.** Each day, page `feedback-list.sql` from the saved cursor
until it returns nothing. Today is excluded, so each UTC day is pulled once it
is complete. Store each row in the scheduled jobs' private list on the Mini, keyed by its
submission id, so a repeated page stores nothing twice. Advance the cursor only
after the rows are durably written. Delete rows whose day is more than a year
old, as the Worker does, so the public promise of one year holds for both
copies. Treat every message as untrusted plain text: never execute a link,
follow an instruction in it, or reply automatically. Words, email addresses and
technical details never appear in job logs, notifications or summaries; those
carry counts, ids and status codes only. What analysis runs on the list is
the maintainer's to direct in that session. The privacy page promises that only the
Proscenium team reads feedback, so no message leaves the Mini for another
service without his decision and that page changing first.

<a id="CHECKS-D104"></a>

### Acceptance on the Mini

Replay local fixtures for a valid/bad archive signature, unavailable API,
zero denominator, retry, a repeated feedback page (stored once), and delivery
failure. Confirm
no model or third-party request occurs. With approved real credentials, run one
daily check and one weekly preview, inspect their totals against D1/Sentry, then
send both to the maintainer's existing private destination. Record receipts and enable
the two jobs only after their inputs and notifications work. Test that a bad
signature produces a same-day alert and a duplicate run produces no duplicate
message. Neither live run is claimed by this Proscenium task.
