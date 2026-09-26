# Privacy and telemetry

[Keeping your work](README.md) › Privacy

This contract defines the privacy promise, permitted network traffic, report contents and the controls a writer has over them.

[Privacy promise](#PRIV-D1) · [Network boundary](#PRIV-D2) · [Usage counts](#PRIV-D3) · [Crash reports](#PRIV-D4) · [Diagnostics](#PRIV-D5)

## Requirements

<a id="PRIV-D100"></a>

<a id="PRIV-1"></a>

**PRIV-1** Automatic reports carry no writing. Send Feedback sends only what the writer chooses to send.

<a id="PRIV-D1"></a>

### The privacy promise

- <a id="PRIV-2"></a> **PRIV-2** **Your plays and files stay on your Mac.** Proscenium never sends your writing, a title, a character's name, or
  where your files are automatically. Send Feedback sends the words you choose
  to put in its form. It checks for updates, and unless you switch it off it
  sends a few anonymous facts — which version, which features get used, when it
  crashed — so it can get better. No accounts, no sign-in, no cloud.
- <a id="PRIV-3"></a> **PRIV-3** The README, product description and release material must state the same privacy boundary.
- <a id="PRIV-4"></a> **PRIV-4** **The site** writes its own words from the facts below.

<a id="PRIV-D2"></a>

### The network, locked down

1. <a id="PRIV-5"></a> **PRIV-5** **All network traffic leaves from Rust.** The webview gets a strict content
   security policy in `tauri.conf.json` (`security.csp`):
   - <a id="PRIV-6"></a> **PRIV-6** `default-src 'self'`, and `connect-src` limited to the IPC origins;
   - <a id="PRIV-7"></a> **PRIV-7** no remote scripts, frames, fonts or images;
   - <a id="PRIV-8"></a> **PRIV-8** development allowances in `devCsp` only.

   On macOS a `WKContentRuleList` is compiled and installed before the window
   is created. It blocks every URL except the app's local schemes and IPC;
   development adds only its local server. A policy compilation failure stops
   startup. This closes speculative preconnects that bypass CSP.
2. <a id="PRIV-9"></a> **PRIV-9** **One allowlist.** A single Rust module holds the only outbound hosts: the
   owned update, reports and feedback hosts, plus the updater's independent
   GitHub fallback. Browser links go through `go.proscenium.ink`.
   - <a id="PRIV-10"></a> **PRIV-10** A unit test asserts that list.
   - <a id="PRIV-11"></a> **PRIV-11** A CI check fails on an `http(s)://` literal anywhere else in `src/` or
     `src-tauri/src/`, except documentation comments and the allowlist itself.
   - <a id="PRIV-83"></a> **PRIV-83** The sponsors' program in Settings › About is baked into a release
     at build time (docs/app/preferences-and-help/settings.md#SET-34); the app never fetches it,
     and it names only sponsors who chose to be public.
   - <a id="PRIV-12"></a> **PRIV-12** Update manifest URLs, archive URLs, and every redirect are checked against
     the owned update host or the exact fallback GitHub hosts over HTTPS. Archive downloads stop at 512 MiB,
     including chunked responses; signature verification precedes unpacking.
3. <a id="PRIV-13"></a> **PRIV-13** **Smoke proves the page is silent.** It records every request the webview makes
   and fails on any that is not to the local test server.
   `bun run check:webkit-network` additionally runs the actual release rules and
   CSP in an offscreen WKWebView. An unprotected control must reach a loopback
   TCP listener; the protected preconnect must make zero connections. This
   measures sockets, not public DNS packets; floor-macOS and DNS observation
   remain separate release checks.

<a id="PRIV-D3"></a>

### Usage counts

<a id="PRIV-14"></a>

**PRIV-14** Usage is stored as daily totals in Cloudflare D1. There is no analytics account or key in the app. Rust posts to
`reports.proscenium.ink/v1/events`; the page only names an event from its closed
IPC enum. A release build opts in at compile time with
`PROSCENIUM_REPORTS=1`, set by release.mjs. Rehearsals, development builds and
app:install builds send no usage or crash reports.

<a id="PRIV-15"></a>

**PRIV-15** The batch is `{ version, platform, arch, os, channel, events }`. `platform` is
`darwin`; `arch` is `aarch64` or `x86_64`; `os` is the macOS major/minor version;
`channel` is `developer-id` or `app-store`. Each event is `{ name, props }`.
There is no client timestamp, session id, user id, locale, device name, cookie
or user-agent. No property accepts arbitrary text. Unknown names, properties,
values, versions or platforms cause the Worker to refuse the whole batch.

| Event | Properties | Requirement |
|---|---| --- |
| `app_launched` | none; channel belongs to the batch | <a id="PRIV-16"></a>PRIV-16 |
| `play_opened` | `plays`: `1`, `2-5`, `6-20`, `21+` | <a id="PRIV-17"></a>PRIV-17 |
| `surface_shown` | `surface`: `script`, `board`, `outline`, `cast`, `changes`, `format-designer`; each at most once per launch | <a id="PRIV-18"></a>PRIV-18 |
| `pdf_exported` | `kind`: `whole`, `range`, `sides`; `format`: a shipped format id or `user` | <a id="PRIV-19"></a>PRIV-19 |
| `format_saved` | none | <a id="PRIV-20"></a>PRIV-20 |
| `update_installed` | `from`, `to`: released versions | <a id="PRIV-21"></a>PRIV-21 |
| `error_shown` | `code`: one of the error codes in events.rs | <a id="PRIV-22"></a>PRIV-22 |

<a id="PRIV-23"></a>

**PRIV-23** `events.rs` is the closed native list. A JSON copy in `services/edge/` drives
Worker validation and the public table; a Rust test compares the two. The
public table also has a test, so adding a field requires adding its reason.
The usage event list excludes `crash_reported`. Sentry receives crash reports separately.

<a id="PRIV-24"></a>

**PRIV-24** The Worker stores only a UTC day, the batch dimensions, an event name, its
properties and a count. Each accepted event adds one to its combination. D1
never stores the original batch or a request record. Daily totals are kept
for two years, then deleted by the Worker's daily retention job. These are
counts of actions, not people. A repeated launch checks again; a retry after a
lost response can count again. No identifier is added to deduplicate people.

<a id="PRIV-25"></a>

**PRIV-25** The switch, **Share anonymous usage and crash reports**, stays on by
default. The Welcome notice appears once, or the same notice appears in the
workspace if a release opens straight into a play. Sending waits until the
notice has appeared and a minute has passed since launch. Turning the switch
off clears the pending queues immediately. A request already on the wire
cannot be recalled. Updates have their own switch. Manual feedback does not
use either switch.

<a id="PRIV-26"></a>

**PRIV-26** Usage events wait in memory, never on disk: at most 100, oldest first. A batch
holds at most 25. Events seven days old are discarded. A network failure,
server failure or rate limit puts the batch back; another event must arrive
before the next scheduled attempt. There is no retry timer for a failed batch.
Other 4xx replies discard the batch. A normal quit has at most two seconds for
one final flush, subject to the same notice, grace period and consent gates.

<a id="PRIV-D4"></a>

### Crash reports

<a id="PRIV-27"></a>

**PRIV-27** Sentry receives Rust panics and uncaught JavaScript failures. The reports switch controls them, on by default. No memory dump is made
or sent. A report contains stack frames and the small set of fields in docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D7.
It never contains a panic/error message, a file path, source text, local
variables, a request, a breadcrumb or an attachment. There are no performance
traces, session replays, profiles, automatic HTTP integrations or AI features.

<a id="PRIV-28"></a>

**PRIV-28** The native panic hook reads compiled stack symbols and line numbers without
reading the panic's message. It never serializes a symbol's source filename.
JavaScript supplies only validated frames from the app's bundle and a failure
kind from a closed list. The app drops origins, filenames and paths. Frames
name a code module, a compiled native function when available, and line/column
numbers. A failure without a usable stack is not sent; it is not turned into
a message report. OS aborts, process kills and macOS's own crash handling are
outside this hook. Proscenium does not enable a dump collector to cover them.

<a id="PRIV-29"></a>

**PRIV-29** At most 20 crash files stay in app data. They carry a random id for that crash
only, so a failed send can retry without inventing another crash. They carry
no identifier shared by two crashes. The next release launch queues readable,
validated records from the last seven days. The same grace period and consent
check used for counts applies. A successful receipt removes that local record;
an offline attempt keeps it. Switching reports off clears the pending queue
and leaves local files available to Copy Diagnostics. Old crash files are
never trusted as ready-made network payloads.

<a id="PRIV-30"></a>

**PRIV-30** The Sentry SDK's protocol types build a single event envelope. The app uses
its own Rust transport to `reports.proscenium.ink`; no Sentry address or key is
in the app. The Worker accepts only that project route, one event item, bounded
stack frames, and the exact schema in docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D7. It refuses unknown keys and every
other envelope item type, including attachments and minidumps. The actual
Sentry destination is a Worker secret. Outbound requests contain no incoming
headers or sender address. Forwarding uses a TLS socket with an explicit HTTP
request, so Cloudflare's fetch layer cannot insert visitor-address headers.

<a id="PRIV-31"></a>

**PRIV-31** The forwarding path requires proof. Cloudflare documents that ordinary Worker
subrequests can receive implicit visitor-address headers even when application
code starts with empty headers. Tests inspect the exact outgoing bytes. The
live Sentry check also confirms that the event has no user/address fields, and
**Prevent Storing of IP Addresses** must be on before the route is enabled.
Worker request logs stay off.

<a id="PRIV-32"></a>

**PRIV-32** Use Sentry's free Developer plan, with its 30-day error lookback. Confirm the
actual project's retention before enabling it and record that verification as release evidence. Quotas drop excess reports; no paid overage or AI add-on is enabled.
No account is created and no project setting is changed by this repo's build.
The maintainer creates the account and approves the project settings separately.

Sources:
[Cloudflare's header behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/),
[Cloudflare TLS sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/),
[Sentry event payloads](https://develop.sentry.dev/sdk/foundations/envelopes/event-payloads/),
[Sentry envelopes](https://develop.sentry.dev/sdk/envelopes/),
[Sentry plans and retention](https://sentry.io/pricing/).

<a id="PRIV-D5"></a>

### Diagnostics a writer controls

- <a id="PRIV-34"></a> **PRIV-34** **Error codes.** Errors the app shows get stable codes (`E-VAULT-READ`,
  `E-EXPORT-FONT`, …), kept in a small local ring log. The local ring excludes the retired `conflict-repro.log` instrumentation.
- <a id="PRIV-35"></a> **PRIV-35** **Help › Copy Diagnostics** (also in Settings › About) puts plain text on the
  clipboard:
  - <a id="PRIV-36"></a> **PRIV-36** app version and channel, architecture, macOS version;
  - <a id="PRIV-37"></a> **PRIV-37** the accent, and the format ids in use (user formats as `user`);
  - <a id="PRIV-38"></a> **PRIV-38** the settings switches;
  - <a id="PRIV-39"></a> **PRIV-39** the Plays folder's provider kind (iCloud, Dropbox, Syncthing or local) —
    never its path;
  - <a id="PRIV-40"></a> **PRIV-40** the last 20 error codes with times, and any crash files.

  The writer reads it before pasting it anywhere.
- <a id="PRIV-41"></a> **PRIV-41** **Send Feedback** (toolbar, Help and About) opens the private feedback sheet.
  The message is required; email and the exact inspectable technical details
  are optional. Closing keeps one draft outside the Plays folder. Nothing is
  sent until Send, and only a matching 201 receipt clears the draft. See
  [feedback.md](../../engineering/services-and-feedback.md).

<a id="PRIV-D6"></a>

### Tests and proof

- <a id="PRIV-42"></a> **PRIV-42** Unit tests:
  - <a id="PRIV-43"></a> **PRIV-43** the event enum serializes to exactly the documented properties;
  - <a id="PRIV-44"></a> **PRIV-44** the bucketing;
  - <a id="PRIV-45"></a> **PRIV-45** the allowlist;
  - <a id="PRIV-46"></a> **PRIV-46** the panic hook and envelope contain neither messages nor paths;
  - <a id="PRIV-47"></a> **PRIV-47** Worker event schema and the public table agree with every enum value;
  - <a id="PRIV-48"></a> **PRIV-48** strict crash envelopes and forwarding bytes contain no address header;
  - <a id="PRIV-49"></a> **PRIV-49** diagnostics text contains no path, via a test with a play at a known path.
- <a id="PRIV-50"></a> **PRIV-50** Smoke: the webview makes no external request, and the Privacy section passes
  its audit.
- <a id="PRIV-51"></a> **PRIV-51** A manual check with a network monitor (Little Snitch or `nettop`) on a real
  launch-to-export session, recorded as release evidence: only allowlisted service hosts
  appear; with both automatic switches off, none unless the writer explicitly
  sends feedback.

<a id="PRIV-D7"></a>

### Facts for the site and the store

<a id="PRIV-52"></a>

**PRIV-52** Your plays and files stay on your Mac. Proscenium never collects your writing:
no play text, titles, character names, filenames or paths. Usage counts record
which features are used, never what you write with them. Send Feedback sends
only the words you choose to put in its form. Exporting, copying and sharing a
file do what you ask them to do. A Plays folder in a sync service and macOS
features such as Writing Tools, Services and Universal Clipboard follow their
own settings.

<a id="PRIV-53"></a>

**PRIV-53** **Everything Proscenium collects, and why.** The table below is the complete
list of data that may leave your Mac; anything not in it is not collected. No
reason, no field. A test holds the table to the app's list of events and to our
service's, so neither can send something this page does not list.

| What is sent | Fields and allowed values | Why | Requirement |
|---|---|---| --- |
| Update check | platform `darwin`; chip `aarch64` or `x86_64`; current app version; macOS major/minor in `Proscenium-OS` | Find a compatible update and count how often copies of each version are used on each system. This is an estimate of copies, not a count of people. | <a id="PRIV-54"></a>PRIV-54 |
| Release download | release version and one of its own DMG, signed archive or signature filenames | Deliver the chosen release and count downloads by version. These are our release filenames, never yours. | <a id="PRIV-55"></a>PRIV-55 |
| Every usage batch | `version`, `platform`, `arch`, `os`, `channel` (`developer-id` or `app-store`) | See which releases, systems and delivery channels need support. | <a id="PRIV-56"></a>PRIV-56 |
| Usage batch shape | `events`: up to 25 items, each with `name` and `props` from the rows below | Group counts into fewer requests without identifying a session. | <a id="PRIV-57"></a>PRIV-57 |
| `app_launched` | no extra properties | Count how often the app opens each day. | <a id="PRIV-58"></a>PRIV-58 |
| `play_opened` | `plays`: `1`, `2-5`, `6-20`, `21+` | Guide work on the Plays screen without an exact play count. | <a id="PRIV-59"></a>PRIV-59 |
| `surface_shown` | `surface`: `script`, `board`, `outline`, `cast`, `changes`, `format-designer` | See which parts of the app get used and which need work. | <a id="PRIV-60"></a>PRIV-60 |
| `pdf_exported` | `kind`: `whole`, `range`, `sides`; `format`: `dg-modern`, `stage-us-modern`, `stage-uk`, `samuel-french`, `dg-traditional`, `dg-musical`, `sketch-comedy`, `user` | Decide which exports and built-in formats to improve. | <a id="PRIV-61"></a>PRIV-61 |
| `format_saved` | no extra properties | Know whether writers make their own formats. | <a id="PRIV-62"></a>PRIV-62 |
| `update_installed` | `from`: released version numbers; `to`: released version numbers | Check whether updates arrive and how far behind copies fall. | <a id="PRIV-63"></a>PRIV-63 |
| `error_shown` | `code`: `E-BOOT`, `E-FOLDER-OPEN`, `E-FOLDER-REFUSED`, `E-FOLDER-ACCESS`, `E-ICLOUD`, `E-PLAY-OPEN`, `E-PLAY-MISSING`, `E-PLAY-CREATE`, `E-SAVE`, `E-SAVE-LOCKED`, `E-SAVE-PERMISSION`, `E-SAVE-NOT-ALLOWED`, `E-SAVE-DISK-FULL`, `E-SAVE-READ-ONLY`, `E-SAVE-FOLDER-GONE`, `E-SAVE-UNREACHABLE`, `E-CHANGED-ON-DISK`, `E-VERSIONS`, `E-BINDER`, `E-ACTION-STALE`, `E-VAULT-READ`, `E-VAULT-PERMISSION`, `E-EXPORT-PDF`, `E-EXPORT-FONT`, `E-PRINT`, `E-FORMAT-READ`, `E-FORMAT-IMPORT`, `E-FORMAT-EXPORT`, `E-FORMAT-SAVE`, `E-FORMAT-TRASH`, `E-FORMATS-FOLDER`, `E-REVEAL`, `E-FINDER-OPEN`, `E-UPDATE-RESTART`, `E-WATCH`, `E-WORKSPACE`, `E-OTHER` | Fix the errors writers actually meet without collecting error messages. | <a id="PRIV-64"></a>PRIV-64 |
| One crash | `event_id`: a random UUID for that crash, repeated in the envelope | Let Sentry recognize a retry of the same crash. It does not identify a writer, device or session. | <a id="PRIV-65"></a>PRIV-65 |
| Crash context | `release`: app version; `platform`: javascript (omitted for native, the protocol default); `tags`: app platform, chip and macOS major/minor; `timestamp`: UTC day at midnight, as Unix seconds | Find the affected build and system, and the day it failed. No precise crash time leaves the Mac. | <a id="PRIV-66"></a>PRIV-66 |
| Crash failure | `level`: fatal; one `exception` with a kind from the closed list and a `stacktrace` | Group failures by where execution stopped. No exception message or value is allowed. | <a id="PRIV-67"></a>PRIV-67 |
| Each stack frame | `module`: native or webview; optional compiled `function`, `lineno`, `colno` | Locate the failing code. No filename, path, source line, memory address or local variable is sent. | <a id="PRIV-68"></a>PRIV-68 |
| Crash envelope | item `type`: event; byte `length`; event id | Give Sentry the format and size of its single crash event. No other item type is allowed. | <a id="PRIV-69"></a>PRIV-69 |
| Feedback | `id`: one random submission UUID; `message`: your text | Store the message once, including when a response is lost, and let you tell us what you need. | <a id="PRIV-70"></a>PRIV-70 |
| Optional feedback email | `email`: only when you enter it | Reply to you. It is not used for marketing or added to a usage or crash report. | <a id="PRIV-71"></a>PRIV-71 |
| Optional feedback details | The exact text under View Details, only when Include technical details is checked | Help understand the problem you are reporting. | <a id="PRIV-72"></a>PRIV-72 |
| Included diagnostic facts | app version/channel, chip, macOS version, accent, built-in format ids or `user`, default format, preference switches, sync-provider kind | Reproduce the setup that matters to your feedback. No play, user-format name, learned word or path appears. | <a id="PRIV-73"></a>PRIV-73 |
| Included diagnostic history | last 20 error codes with their local times/repeat counts; safe local crash summaries | Understand the failures you chose to show us. These precise local times appear only in details you inspect and include. | <a id="PRIV-74"></a>PRIV-74 |
| A browser link you choose | releases, one release version, license, support or privacy | Open the page you requested. These links are not usage events. | <a id="PRIV-75"></a>PRIV-75 |

<a id="PRIV-76"></a>

**PRIV-76** The failure kinds are `RustPanic` for a native panic and `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`, `InternalError`, `UnhandledRejection`, `PageError`, `AbortError`, `DataCloneError`, `InvalidStateError`, `NotFoundError`, `NotAllowedError`, `NotSupportedError`, `SecurityError`, `QuotaExceededError`, `NetworkError`, `TimeoutError`, `InvalidCharacterError`, `HierarchyRequestError`, `IndexSizeError` for a page failure. An unrecognized page failure uses `Error`.

<a id="PRIV-77"></a>

**PRIV-77** The built-in format values are `dg-modern`, `stage-us-modern`, `stage-uk`, `samuel-french`, `dg-traditional`, `dg-musical`, `sketch-comedy`, and
`user` for every format you made. The error code values are `E-BOOT`, `E-FOLDER-OPEN`, `E-FOLDER-REFUSED`, `E-FOLDER-ACCESS`, `E-ICLOUD`, `E-PLAY-OPEN`, `E-PLAY-MISSING`, `E-PLAY-CREATE`, `E-SAVE`, `E-SAVE-LOCKED`, `E-SAVE-PERMISSION`, `E-SAVE-NOT-ALLOWED`, `E-SAVE-DISK-FULL`, `E-SAVE-READ-ONLY`, `E-SAVE-FOLDER-GONE`, `E-SAVE-UNREACHABLE`, `E-CHANGED-ON-DISK`, `E-VERSIONS`, `E-BINDER`, `E-ACTION-STALE`, `E-VAULT-READ`, `E-VAULT-PERMISSION`, `E-EXPORT-PDF`, `E-EXPORT-FONT`, `E-PRINT`, `E-FORMAT-READ`, `E-FORMAT-IMPORT`, `E-FORMAT-EXPORT`, `E-FORMAT-SAVE`, `E-FORMAT-TRASH`, `E-FORMATS-FOLDER`, `E-REVEAL`, `E-FINDER-OPEN`, `E-UPDATE-RESTART`, `E-WATCH`, `E-WORKSPACE`, `E-OTHER`.

<a id="PRIV-78"></a>

**PRIV-78** There are no usage/session/user ids, exact play counts, location fields,
locale, device names, cookies, custom user-agent strings or writing in the
automatic reports. Any connection shows your internet address to the service
that answers it. Our service uses it only while answering, to handle the
connection and limit abuse; it is not stored, turned into an identifier or
passed on. Sentry labels each crash report with an approximate country and
city, worked out from the server that passed the report on: one near you,
never your own address. We do not use that label. If our update service
cannot be reached, the app checks GitHub for updates instead, connecting to it
directly.

<a id="PRIV-79"></a>

**PRIV-79** Our service runs on Cloudflare, and crash reports are stored with Sentry.
Both handle this data only on our behalf. Update checks, downloads and usage
counts are kept only as daily totals, for two years, with no record of any
single request. Crash reports are kept for 30 days, and our service keeps no
copy of them. On your Mac, unsent usage counts wait only in memory, for up to
seven days, and at most 20 crash records wait until they are sent or replaced
by newer ones.

<a id="PRIV-80"></a>

**PRIV-80** Feedback is held privately and securely by the Proscenium team, and every
copy is deleted after one year. Only the team reads it, and it is never
forwarded or shared. Your address is used only to reply to you. The app keeps one unsent
draft outside the Plays folder until a confirmed send or Discard Draft. It is
never sent in the background. Technical details are gathered fresh and are not
saved in the draft.

<a id="PRIV-81"></a>

**PRIV-81** Settings > Privacy turns usage and crash reports off immediately and discards
queued reports. Update checks have their own switch. Feedback remains available
with both off. Opening or closing Feedback sends nothing.

<a id="PRIV-84"></a>

**PRIV-84** **This website** counts visits with Cloudflare Web Analytics: totals such as
the pages viewed, the site that sent you there and your country. It sets no
cookies, stores nothing in your browser and does not follow you from site to
site. A link you open from the app is an ordinary visit; the app itself sends
nothing to the website.

<a id="PRIV-85"></a>

**PRIV-85** **Sponsors** give through GitHub Sponsors, and GitHub handles the payment; we
never see card details. GitHub tells us each sponsorship's amount and date and,
unless you sponsor privately, your public GitHub name. We keep that only to
thank you by name on this website and in the app's About. A private sponsor is
counted, never named. A monthly sponsor is removed when the sponsorship ends,
and a one-time gift after a year. The app never asks for the list: each release
carries it as it stood when that release was built. GitHub's own terms cover
what GitHub keeps and shows us.

<a id="PRIV-82"></a>

**PRIV-82** For a store submission, describe Product Interaction and Crash Data as not
linked to a person and not used for tracking. Manual feedback also carries
user-provided Other User Content and, optionally, Email Address. Confirm the
store's current definitions and the deployed service settings at submission;
do not claim Data Not Collected. The separately maintained website,
proscenium.ink, must publish this same table before reports are
enabled for distribution.

## Design

Native networking is confined to `src-tauri/src/telemetry/allowlist.rs` and the clients that consume it. Closed event enums and envelope validators bound payloads before transport. The webview supplies typed events and validated stack frames, with CSP and native WebKit content rules fencing its network access.

`services/edge/events.json` and `crash-kinds.json` describe the service-side closed schemas. Native tests compare the event list and public fact table with those files. The website's independently maintained privacy copy is checked against `docs/site-privacy.md`; no app-to-site generation occurs.

The Facts section is exact about what leaves the Mac and how long each kind is kept, and names the service providers that hold it. It says nothing of which machine holds a copy or how copies move (docs/engineering/services-and-feedback.md#SERV-51); that operational detail belongs to the services contract. `services/edge/test/reports.test.ts` holds `docs/site-privacy.md` to this section's prose, and the website's `tools/check-privacy.ts` holds its page to `docs/site-privacy.md`.

The Facts for the site and the store table above is the complete field-and-reason contract. The native event tests, service schema tests and allowlist are its implementation sources. Deployment proofs and retention checks belong in the privacy and service records.
