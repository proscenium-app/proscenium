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
| `https://updates.proscenium.ink/v1/{{target}}/{{arch}}/{{current_version}}` | the updater, download builds | counts the check; answers with the release's `latest.json`, its archive addresses rewritten to the update route ([SERV-287](#SERV-287)) | <a id="SERV-2"></a>SERV-2 |
| `https://updates.proscenium.ink/v1/download/v<version>/<file>` | the website's Download and the Homebrew cask; the updater, before [SERV-286](#SERV-286) | streams that file from the GitHub release, counted as a download by where it came from ([SERV-286](#SERV-286)) | <a id="SERV-3"></a>SERV-3 |
| `https://updates.proscenium.ink/v1/update/v<version>/<file>` | the updater | streams that file from the GitHub release, counted as an update ([SERV-286](#SERV-286)) | <a id="SERV-287"></a>SERV-287 |
| `https://updates.proscenium.ink/v1/stable/{{target}}/{{arch}}/{{current_version}}` | the updater, stable builds with tracks | the same as SERV-2, under the track's name | <a id="SERV-248"></a>SERV-248 |
| `https://updates.proscenium.ink/v1/<track>/{{target}}/{{arch}}/{{current_version}}` | the updater, `alpha` and `beta` builds | counts the check; answers with that track's manifest from R2 ([SERV-249](#SERV-249)); alpha only with its key ([SERV-261](#SERV-261)) | <a id="SERV-246"></a>SERV-246 |
| `https://updates.proscenium.ink/v1/<track>/download/v<version>/<file>` | the website's Download of a beta's Windows installers; the updater, before [SERV-286](#SERV-286) | streams that file from the track's R2 objects; alpha only with its key | <a id="SERV-247"></a>SERV-247 |
| `https://updates.proscenium.ink/v1/<track>/update/v<version>/<file>` | the updater | the same as SERV-247, counted as an update ([SERV-286](#SERV-286)) | <a id="SERV-288"></a>SERV-288 |
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
  - <a id="SERV-274"></a> **SERV-274** **A stand-in, local only.** `wrangler.standin.jsonc`
    runs the update routes as production answers them (`bun run dev:standin`, on
    the address its `UPDATES` var names), through its own entry,
    `test/standin-entry.ts`: the three origins production keeps as constants
    (`REPOSITORY`, `GITHUB`, `UPDATES`) come from its vars, and every R2 key it
    reads is under `stand-in/`, the admission list (SERV-268) and the tracks
    alike. So a stand-in release is served from a local bucket seeded with its
    files (`bun test/standin-seed.ts`), and its GitHub manifest and files from a
    GitHub stand-in on loopback (`bun test/github-standin.ts --stand-in`), which
    serves each release build given with its archive at its own address. Every
    address and port the stand-in and its helpers use is one of its vars, so
    rewriting them moves all of it. Every origin must be loopback and the only
    requests it makes are to its own stand-ins: anything else answers 500 before
    it leaves. The configuration names no account, route or remote binding, its
    bucket is a local one of its own, and `scripts/edge-wrangler.mjs` deploys
    `wrangler.jsonc` alone; the production entry, `src/index.ts`, takes no origin
    or prefix from its environment.
  - <a id="SERV-279"></a> **SERV-279** **The stand-in takes crash reports and feedback, as production
    does.** On its one origin, at production's paths, it answers the crash route
    and the feedback route with production's own code: a crash report is taken
    only from a version the stand-in's lists released (SERV-269, SERV-272), a
    published beta's among them, and one it takes goes to a Sentry stand-in on
    loopback (`bun test/sentry-standin.ts`, at its `SENTRY` var) in place of
    Sentry, which keeps a line for each in `.wrangler/standin/sentry.jsonl`: when
    it came, its release, its day and the exception's first line (its kind and
    where it stopped). A stand-in run plants one with
    `bun test/standin-crash.ts --version <v>`: one JavaScript crash, dated its
    day, with a fresh id, exactly as a copy's reporter writes it, posted to
    `/api/proscenium/envelope/` with `Content-Type: application/x-sentry-envelope`
    (`--print` shows the headers and body instead).
  - <a id="SERV-278"></a> **SERV-278** **A track's answer names its archives on the Worker's own
    origin, as stable's does.** The manifest in R2 names each archive on the
    track's update route of the update service's own host, as the pipeline
    writes it (its download route, written before SERV-286), or already of the Worker's own origin; any other address is
    refused. The answer names each archive on the Worker's own origin. In
    production those are one host, so the answer is the manifest as written; a
    stand-in answers the same manifest on its loopback origin, the only one a
    copy made for the update proof admits.
- <a id="SERV-280"></a> **SERV-280** **What a release's clock reads about a build, over a window.**
  Three things, from what the service already keeps, and nothing new is
  collected for them:
  - `copies`: the most update checks the build made on one UTC day the window
    touches (`copies-by-version.sql`), an estimate of the copies on it, since a
    copy checks once a day, has no identifier, and checks again when opened
    twice; null when the service counted no check at all those days, which says
    the counts are missing rather than that no copy checked.
  - `crashes`: the crash reports from the build whose day the window touches,
    and `crashSaid`, one line of how many and what, the most first, within 300
    characters. A report says the UTC day it happened and never the hour, so it
    counts in every window its day touches.
  - `feedback`: the messages from copies on the build received those days
    (`feedback-by-version.sql`, by id alone, no words), as a total and as those
    not among the ids the maintainer has cleared.

  `bun test/standin-evidence.ts --version <v> --from <iso> --until <iso>
  [--cleared id,id]` prints `{ copies, crashes, crashSaid, feedback: { total,
  unmarked } }` from a stand-in's local database and its Sentry stand-in's
  file; the build host's clock reads the same, by the same code
  (`services/edge/src/evidence.ts`), from production's D1 through
  `scripts/edge-wrangler.mjs query <name> <from> <to> <version>`
  (`wrangler d1 execute … --remote`, read-only) and from Sentry's API: the
  events endpoint of the organization, the `errors` dataset, filtered by
  release, which asks a token with the scope `org:read`. A source that cannot
  be read fails the reading; it is never zero.
- <a id="SERV-19"></a> **SERV-19** **Updates.**
  - <a id="SERV-20"></a> **SERV-20** For each check, add one to the day's count for its platform,
    architecture, version and system version (SERV-282). Then answer with the
    current release's `latest.json` from GitHub, cached at the edge for five
    minutes, with every `url` rewritten to `/v1/update/…` (SERV-287; `/v1/download/…`
    before SERV-286): the entries of the copy's own system alone (SERV-283).
  - <a id="SERV-21"></a> **SERV-21** For each download, stream the file from the GitHub release the path names,
    and count it by version, and by what it was (SERV-286). Only the release's own files are served: the DMG,
    the update archive and its `.sig`, and Windows' installers and their `.sig`s
    from a release whose manifest names them (SERV-283).
  - <a id="SERV-22"></a> **SERV-22** When GitHub cannot be reached, answer 502. The updater then tries its
    second endpoint.
  - <a id="SERV-286"></a> **SERV-286** **A release's file is counted by what it was**, on the
    maintainer's word of 2026-10-23, so a download and an update are never one
    number. Each file the service serves, a release's or a track's, adds one to
    the day's count for its kind, its system and chip (`darwin` and the Mac's
    slice, or `windows` and its chip), and its version, and to nothing else:
    - `website`: a download on the download route (SERV-3, SERV-247), which the
      website's Download names;
    - `homebrew`: a download on the download route whose User-Agent says
      Homebrew (`Homebrew/…`), which the cask names
      (`scripts/homebrew-cask.mjs`);
    - `update`: a file on the update route (SERV-287, SERV-288), which every
      answer to a check names: an installed copy updating. The app sends no
      User-Agent, so the route is how it is told;
    - `signature`: a `.sig` on either route, which an update fetches beside its
      archive, and which is neither a download nor an update;
    - `own`: any of them asked by the project's own machines, which say
      `proscenium-checks` in their User-Agent: the monitor (CHECKS-D101), and
      the release's check of the site's Download (`scripts/ops/release-site.mjs`).

    The User-Agent chooses the kind and is never stored or sent on. Rows from
    before this counted every file as `download`, with no system or chip, and
    stay as they were; `download` is written no more. A track's manifest names
    the update route as the pipeline writes it now; one written before names
    the download route and is read the same (SERV-278). A halted release's
    files are refused on the update routes, and on a track's download route as
    before; stable's download route serves them as GitHub does, since the
    website and the cask name a release until they are moved, and a halt
    deletes nothing (SERV-270).
  - <a id="SERV-267"></a> **SERV-267** **The stable route is proven against GitHub itself before every
    release, never only against a stand-in.** `services/edge/test/workerd-live.node.ts`
    (`bun run test:live`) runs the bundle `wrangler deploy` uploads in workerd
    with the network as its only way out, asks the stable check for the newest
    release as the oldest admitted version would and the download of that
    release's signature file, and passes only when the answers are GitHub's
    own, read directly beside it: the version, date and signatures of
    `latest.json`, the update route as each file's address (SERV-286), and the
    bytes of the file on both routes. It admits what the live service admits:
    the deployed list, and GitHub's newest release when the live service says it has released it, by
    the one answer every route gives (SERV-269), here its `go` link to that
    release's notes, which redirects to the release's page on GitHub only for a
    release it has released (SERV-281). That question carries no credential and
    the route counts and writes nothing. A newest release the live service has
    not released fails the test, as the live stable route would answer 502.
    Reading the deployed list alone, it failed from the day a release was first
    admitted by the list in R2 (SERV-268) with no deploy. A tagged release runs
    it before it builds, and the release procedure runs it by hand before the tag
    (docs/engineering/release-engineering.md#SHIP-D107). It is not the
    pipeline's every-push step, which keeps the stand-in so a push never waits
    on GitHub. From the first deploy to the day of the 1.0.0 release the route's
    two faults, a request GitHub refuses for want of a `User-Agent` and a fetch
    workerd refuses as another object's method, hid behind the loopback
    stand-in the rehearsal used, and every stable check answered 502 for eight days.
  - <a id="SERV-266"></a> **SERV-266** Only a release's source failing answers 502: GitHub or a track's
    R2 objects unreachable, timed out, refusing, or answering something that
    does not validate. A failure of the Worker's own part (a call it makes
    wrongly, a missing binding, D1 or the cache failing) answers 500, empty like
    every refusal. The updater tries its second endpoint on either. A monitor
    that also asks GitHub directly can then tell the service's fault from
    GitHub's without the Worker saying why: for eight days after the first
    deploy every stable check threw inside the Worker, and its 502 read as the
    GitHub release that did not exist yet. The deployed bundle runs in workerd
    in the edge tests (`bun run test:workerd`), so a fault only the runtime
    raises fails there first.
  - <a id="SERV-249"></a> **SERV-249** For `alpha` and `beta`, count each check the same way, then answer
    with the track's manifest from R2, cached at the edge for a minute. Downloads come
    from the same bucket, only of a version on the track's list and only its own
    three files. Publishing to either track writes R2 and needs no Worker deploy;
    stable keeps its admission list, its GitHub releases and its fallback.
  - <a id="SERV-265"></a> **SERV-265** **Intel Macs take stable releases alone**
    (docs/engineering/release-engineering.md#REL-124). The rule is the Mac's: an
    `x86_64` Windows copy is not an Intel Mac, and is answered from its track
    (SERV-283). For the Mac, a track's manifest names either both platforms and
    the universal archive, as the first track builds did, or `darwin-aarch64`
    alone and that version's `_aarch64` archive, as every track build since
    does; anything else is refused to a Mac. Beside the Mac's, it may name
    Windows' two, each system judged on its own part alone (SERV-283). A track version's own files are its universal three or its
    `_aarch64` three, and Windows' four when it carries Windows. A check from an
    Intel Mac (`darwin`, `x86_64`) on `alpha` or `beta`, from a copy built before
    the app followed stable on Intel, is counted as the check it is and answered
    with stable's manifest, exactly as the stable route answers it; alpha's key
    is still asked for first. A release's manifest stays universal for the Mac.
  - <a id="SERV-283"></a> **SERV-283** **Windows beside the Mac, in one manifest.** A
    release's manifest, and a track's, names the Mac's builds as SERV-265 says,
    and beside them Windows' two or none: `windows-x86_64` and `windows-aarch64`,
    each that version's installer for its chip, `Proscenium_<version>_x64-setup.exe`
    and `Proscenium_<version>_arm64-setup.exe`, at the address the Mac's archive
    has (the release on GitHub, or the track's download route).
    - **Each system is judged on its own part alone.** The Mac never waits on
      Windows: a Mac copy is answered from the Mac's entries (`darwin-…`) and a
      Windows copy from Windows' (`windows-…`), and neither part's fault reaches
      the other's copies. A Windows part that is not both chips' installers,
      each at its own address with a signature and nothing more, answers
      Windows' copies 502, the source's failure, and their installer downloads
      too, and changes nothing a Mac is told. A Mac part that is not one
      slice's, or is missing, answers a Mac 502 as it always has, and changes
      nothing a Windows copy is told. A key of a system we do not build is in no
      system's part and is never answered. What every system shares, the
      version, notes and date and the manifest's own fields, still refuses the
      whole manifest. A release still writes the whole of it valid, and the
      stand-in's helpers refuse anything less.
    - **Each copy is answered for its own system.** A check is answered with the
      manifest's entries for the copy's own system alone, each on this
      service's update route for its own file (SERV-286), and with 204, nothing newer,
      when the manifest names no build for the copy's system and chip. So a
      Mac's answer is the same, byte for byte, whether a manifest names Windows
      or not, and a Windows copy hears nothing newer from a manifest that names
      only the Mac, as when a release goes out without Windows. Before this, a
      manifest naming any platform but the Mac's two answered every Mac's check
      502.
    - **Its files.** A release's own files gain Windows' four, an installer and
      its `.sig` per chip, served only when that release's manifest names its
      chip; a track version's gain the same four, served from R2 as its others are.
    - **Halts.** A halt answers Windows as it answers the Mac (SERV-270): the
      release before, with its Windows entries if it carried them, or 204.
  - <a id="SERV-268"></a> **SERV-268** **Stable is admitted by a list the release writes, with no
    deploy.** Beside the deployed list (`RELEASED_VERSIONS_JSON`), the Worker
    reads `admission.json` at the root of its R2 keys, at most once a minute
    through the edge cache: `{ "v": 1, "stable": ["X.Y.Z", …], "halted": [{
    "version", "track", "at", "why" }, …] }`. Stable's admitted releases are
    both lists together; a halt (SERV-270) names its version, the track it is
    halted on (`stable`, `beta` or `alpha`, the version of that track's form),
    when (ISO 8601, with its zone) and why (at most 500 characters). None
    written is an empty list. One that cannot be read, or is not exactly that
    shape (another `v`, a field more or less, a version of the wrong form, over
    64 KiB), is taken as empty, never as admitting or halting anything, and is
    said in the Worker's one line (SERV-275): content once for the minute it is
    kept, R2 failing to answer on each request, since that is asked again. A
    release's admission, and a halt, so take effect within a minute; the
    Worker's own changes are what a deploy is for.
  - <a id="SERV-270"></a> **SERV-270** **A halt stops the offer, and deletes nothing.** A halted
    version is not offered on its track, and everything else about it stands:
    it stays released (SERV-269), its copies are answered and counted, their
    reports are taken, and R2, which the Worker only reads, and GitHub keep its
    files. On stable, a check whose newest release on GitHub is halted is
    answered as if that release were not there: with the newest admitted
    release before it that is not halted, from that release's own
    `latest.json`, and when there is none, or its manifest cannot be had, with
    204, nothing newer. Never an error there: the updater would take an error to
    its GitHub fallback, whose manifest names the halted release (SERV-9). The
    release before is offered because it was the release until the halted one
    was, and the updater installs only a version newer than its own, so no copy
    goes back. On a track, a halted newest version is answered 204, since R2
    keeps no manifest of a track's earlier versions. The update routes, and a
    track's download route, answer a halted version's files 404; stable's
    download route serves them as GitHub does (SERV-286).
  - <a id="SERV-271"></a> **SERV-271** **While a halt is in force, nothing sends the updater to
    GitHub.** A halt on stable is in force when the newest release the service
    knows, admitted or halted, is halted: GitHub's newest release is then most
    likely that one. Until another release is admitted past it, a stable check
    that fails (GitHub unreachable or answering something unusable, or the
    Worker's own fault) answers 204 in place of SERV-22's 502 and SERV-266's 500.
    A check the service refuses before it asks anything (a switch, a limit, a
    version it never released) still goes on to GitHub, as every refusal does.
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
- <a id="SERV-272"></a> **SERV-272** **A published beta's reports are taken as a release's, and
  counted apart.** A copy reports its whole build version (the version it asks
  for updates with): a release `X.Y.Z`, the same as its package's, or a track
  build's `X.Y.Z-beta.N`. A usage batch or a crash report from a beta its track
  has published is taken as one from a release; one from a beta the track never
  published, or from an alpha, is refused whole, as a version never released is
  (SERV-106). Each usage count records its track, `stable` or `beta` (D1
  `usage_counts.track`, migration 0006), read from the lists when the batch is
  taken, and the queries count the two apart; a crash report goes on to Sentry
  with its whole version as its release, which is how Sentry tells them apart.
  `update_installed` still names releases alone: a move to or from a beta is
  not reported. A track's list that cannot be read answers 503, so the app
  keeps the report for later; the admission list is taken as empty then
  (SERV-268), so a release on it alone is refused until it can be read.
- <a id="SERV-32"></a> **SERV-32** **Feedback** (decision 7, [feedback.md](../app/preferences-and-help/feedback.md)).
  - <a id="SERV-33"></a> **SERV-33** A message carries a submission id and the writer's text. It carries an
    email and technical details only when the writer gave them, and nothing
    else, not even the app version.
  - <a id="SERV-276"></a> **SERV-276** The Worker checks the sizes, a well-formed email if there is one,
    a build's whole version if there is one (SERV-273), and that no other field
    is present. It replaces SERV-34
    (docs/engineering/withdrawn-requirements.md#SERV-34).
  - <a id="SERV-273"></a> **SERV-273** **The Worker keeps a message's build version when the copy
    says it.** A message may carry `version`, the whole build version it was sent
    from: `X.Y.Z`, `X.Y.Z-beta.N` or `X.Y.Z-alpha.N`, of that form and nothing
    else, or it is refused with a reason. It is stored with the message (D1
    `feedback_messages.version`, migration 0007; NULL when absent), so the
    messages from copies on a beta can be counted, by the words-free receipts
    (`feedback-receipts.sql`). A message is never refused for being from a
    version that was not released: the writer's words matter more. The Worker
    takes the field before any copy sends it, since a Worker without it refuses
    the message whole; a copy sends it only once the privacy page lists it
    (SERV-50), and until then SERV-33 describes what a message carries.
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
  - <a id="SERV-281"></a> **SERV-281** **A version's link goes to that version's notes.**
    `releases/v<version>` redirects a release stable has released to its page on
    GitHub, and a beta its track has published to the Guide's What's new page, at
    the section that lists the beta that is out
    (`https://docs.proscenium.ink/whats-new#beta`): GitHub holds releases alone,
    so a beta has no page there. Every published beta goes to that one address:
    the section is always the beta that is out. Which version is released is
    SERV-269's answer, so a halted version keeps its notes. Any other version,
    an alpha's and a beta's its track never published among them, gets the bare
    404, and a list that cannot be read answers 503.
- <a id="SERV-40"></a> **SERV-40** **What it keeps:** the daily counts and the feedback messages, and nothing
  about any single request.
  - <a id="SERV-275"></a> **SERV-275** Workers Logs stays off. The Worker writes one kind of line of its
    own, and no other: that the admission list (SERV-268) could not be read, or
    is not one, naming its key and nothing of any request. With Workers Logs
    off it is kept nowhere; it shows in a local `wrangler dev` and to a live
    `wrangler tail`, and the behaviour it names is seen from outside anyway, as a
    release that is not admitted. It replaces SERV-41
    (docs/engineering/withdrawn-requirements.md#SERV-41).
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
  and where each kind of data goes and for how long. "Where" is whose hands:
  the writer's Mac, the Proscenium team, and the service providers it names.
  The page never says which machine holds a copy or how copies move between
  them (decided 2026-09-25), so that plumbing can change without the page
  becoming untrue, and so the page is no map of where the data sits.
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
| `copy_active` | day, week or month; whether the copy first ran in the last 7 days, the last 30, or before | how many copies are in use each day, week and month, and how many are new: each copy counts itself once a period and remembers it, so the service needs no identifier (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86) | <a id="SERV-285"></a>SERV-285 |
| A crash report | where in the code it failed (stack traces), the kind of failure, app version, macOS version, chip | to find the crash and fix it | <a id="SERV-63"></a>SERV-63 |
| A feedback message | your words; your email and the technical details only if you add them | so you can tell us anything, and we can answer | <a id="SERV-64"></a>SERV-64 |

- <a id="SERV-65"></a> **SERV-65** **Never collected automatically:** anything you write or name. That means a play's text,
  titles, character names, and file or folder names or paths.
- <a id="SERV-66"></a> **SERV-66** **Also never collected:** exact counts; error or crash message text; the
  contents of memory; your IP address; your Mac's name or any identifier; and
  anything that ties a count to you. Active copies (`copy_active`) are
  deduplicated on the copy itself, which remembers what it has counted and
  sends none of it, so they need no identifier either.
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
  is refused. The platforms we build, and the system versions each is built
  for, are SERV-282's.
  - <a id="SERV-282"></a> **SERV-282** **The systems we build, and how each names its
    version.** A copy runs on a Mac (`darwin`) or on Windows (`windows`), on
    either chip (`aarch64`, `x86_64`). It names its system's version in its
    update check's `Proscenium-OS` and in a report's `os`, in that system's form
    and no finer: a Mac's `<major>.<minor>`, from macOS 14, such as `15.6`;
    Windows' `10.0.<build>`, from Windows 10 22H2's build 19045, such as
    `10.0.26100` (Windows 11 is 10.0 too, from build 22000). Windows' update
    revision after the build is not sent, as a Mac's patch number is not. A
    usage batch's channel is its own system's too: a Mac's `developer-id` (the
    download) or `app-store`; Windows' `download` (its installer, from the site,
    GitHub or winget) or `microsoft-store`. An address naming another system is
    a bare 404 (SERV-98). A version or a channel that is not its own system's, a
    Mac's from Windows or Windows' from a Mac included, is refused with a 400: a
    check before it is counted, and a usage batch or a crash report whole.
  - <a id="SERV-250"></a> **SERV-250** A version counts as released when the stable admission list or any
    track's list of published versions holds it, so a copy that changes track is
    never refused for the track it came from.
  - <a id="SERV-269"></a> **SERV-269** **One answer to "was this version released", for every
    route.** A release `X.Y.Z` is stable's when the deployed list or the
    admission list (SERV-268) holds it; a track build's whole version,
    `X.Y.Z-beta.N` or `X.Y.Z-alpha.N`, is released when its own track's list of
    published versions holds it. What counts depends on who asks: an update
    check takes all three (SERV-250); usage counts and crash reports take stable
    and beta (SERV-272); a `go` link to a version's notes takes stable and beta
    too (SERV-281), since an alpha has no notes to open. A halt does not change
    this answer, only what is offered (SERV-270): a copy that installed a
    release before it was halted is still answered, counted and heard.
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
3. <a id="SERV-264"></a> **SERV-264** **Launch day.** The first update through
   `updates.proscenium.ink` on stable, 0.9.x to 1.0.0, is not proven by a machine:
   the update proof builds the version updated from, and no 0.9.x carries it.
   From 1.0.1 on, the update proof on the build host updates a copy of the
   release before to the new one through that host
   ([release-engineering.md#SHIP-D109](release-engineering.md#SHIP-D109), step 7).
   The updater's way to GitHub with that host unreachable is proven by its
   native tests and the rehearsal that ran it headless. It replaces SERV-260
   (docs/engineering/withdrawn-requirements.md#SERV-260).

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
  - an Apple-silicon-only track manifest and its files are served, a mixed one
    is refused, and an Intel check on a track gets stable's manifest (SERV-265).
  - <a id="SERV-277"></a> **SERV-277** a release on the admission list in R2 is answered, offered
    and served with no deploy, and a list that is not one admits and halts
    nothing and is said once; a halt stops the offer on every route that offers
    and deletes nothing, stable offering the release before it or 204 and never
    an error while it is in force; a published beta's usage counts and crash
    reports are taken and counted apart, an alpha's refused; a message's version
    is stored; and the stand-in's own bundle serves a stand-in release from its
    `stand-in/` keys and its loopback GitHub, asking nothing else. The bundle
    runs in workerd for each (`bun run test:workerd`).
  - <a id="SERV-284"></a> **SERV-284** every answer the Worker gave a Mac before it learned
    Windows is held byte for byte, with every manifest naming the Mac alone,
    with every one naming Windows beside it, and with every one whose Windows
    part is broken, each of seven ways (one chip, an installer elsewhere, the
    other chip's installer, a signature that is not one, a field more, an
    installer's own key, a system we do not build): each check route, chip,
    kind of version and OS header, each download and each refusal, in eight
    states of the service, with what each counted and said, and which of a
    Mac's usage batches and crash reports are taken (`test/mac-answers.test.ts`,
    whose record was made from the Worker before the change); a Windows check
    is answered with Windows' entries alone, or 204 from a manifest that names
    none, or 502 from one whose Windows part is broken, on a track as on
    stable, and from a manifest whose Mac part is broken as from any other;
    Windows' version is held to SERV-282 in a check, a usage batch and a crash
    report; a release's installers are served only when its manifest names
    them; and the bundle runs in workerd for it. Under `wrangler dev --local`,
    `bun test/standin-windows.ts [--against <ref>]` runs the ref's Worker
    (`origin/main`'s by default) and this one on the stand-in, each with the
    Mac's manifests, with manifests naming Windows, and with this one's also
    with a broken Windows part, and passes only when every Mac request is
    answered and counted as the ref's Worker answers it with the Mac's
    manifests, and every Windows request as SERV-283 says.
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
  about failures, by email. Stay quiet when healthy and unchanged. The morning
  summary then lists every open incident first, every day until it clears, and
  says so when this check has not run in 30 hours.
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

GitHub's own `latest.json`, read directly, decides whose fault an answer is. A
502 while GitHub serves the release, or any 500, is the service's
(docs/engineering/services-and-feedback.md#SERV-266); GitHub's manifest missing
means the published release is incomplete and both of the app's endpoints fail;
a 400 means the monitor's version fell off the admission list. Each, and a
version mismatch, a broken signature or an unexpected redirect, is actionable.
Do not silently fall back when checking the health of the primary service.
There is no prelaunch state any more: before launch one recorded every 502 as
"not yet available" until the maintainer switched it off, and after the first
deploy the service's own fault answered that same 502 for eight days, unseen.
A mode that silences an alarm must never wait for a person to end it.

A halt changes what the first endpoint should answer, and the proof reads the
admission list to know it (docs/engineering/services-and-feedback.md#SERV-268).
While a halt is in force the right answer is the newest admitted release before
the halted one, or 204 (docs/engineering/services-and-feedback.md#SERV-270), not
GitHub's `latest.json`; a failure is a 204 too
(docs/engineering/services-and-feedback.md#SERV-271). The proof compares the
answer with the release before in place of GitHub's newest, and reports that a
halt is in force, every day until another release is admitted past it: a halt
is an incident of its own, never a silenced alarm.

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
| `downloads.sql` | start, end | Downloads by people, from the website and Homebrew, by version: requests, not completed installations. Before SERV-286, every file served, updates among them |
| `file-requests.sql` | start, end | Every release file served, by day, what it was (SERV-286), system, chip and version |
| `launches-by-version.sql` | start, end | Launches per version, track and channel: how many copies run the newest release, and how many a published beta (SERV-272). No alpha sends usage counts the service takes |
| `feature-share.sql` | start, end | Event/property counts and actions per 100 launches, by track and channel, so a beta's copies never move a release's shares |
| `daily-volume.sql` | start, end | Daily usage, update and feedback totals for comparisons |
| `feedback-counts.sql` | start, end | Messages per day; no message text |
| `feedback-receipts.sql` | start, end | Per-message receipts (id, day, length, whether an email or details came, and the build version when the copy said it, SERV-273) with no words or address; safe to show, and how feedback from copies on a beta is counted |
| `feedback-list.sql` | cursor day, cursor id, today | The private pull: id, day, message, email, details; 100 rows a page, completed days only; start with empty cursors |
| `copies-by-version.sql` | start, end, version | A build's copies for a release's clock (SERV-280): its most checks on one of those days; NULL when no check at all was counted |
| `feedback-by-version.sql` | start, end, version | The ids of the messages from copies on a build (SERV-280); no words or address |
| `usage-by-day.sql` | start, end | Each day's count of every event and property value, by version and track: one feature over time, for the usage page (CHECKS-D105) |
| `launches-by-day.sql` | start, end | Each day's launches by version, track, channel, chip and macOS: which releases and systems the app is opened on (CHECKS-D105) |
| `active-by-day.sql` | start, end | Each day's active copies by version, track, platform, chip, system version, channel, period and installed; a period's rows summed over its days are its distinct active copies (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86, CHECKS-D105) |

The scheduled service checks use Cloudflare's D1 query API with a D1 Read
token. A release's clock reads the two queries it needs through
`scripts/edge-wrangler.mjs query` with the one deploy token
(docs/engineering/services-and-feedback.md#SERV-251), which the build host
already holds for the Worker and the tracks' bucket: a second, narrower token
on the same machine would guard nothing that machine cannot reach anyway, so
for the clock the queries being read-only is the SQL's own, reviewed here, and
not the token's. Either way, fix the account/database IDs in reviewed
configuration, reject any response with `success: false`, errors or missing
results, and never try a write against production as a test of anything.
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
people, unique users, or a population crash rate. The one exception is
`copy_active` (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86): a
period's sum is its unique active copies, and is called that, "active copies",
daily, weekly or monthly, with new and returning by `installed`. Still never
"people" or "writers": one writer may run two copies, and a copy with usage
reports switched off sends none. The rule stands for every other event.

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

<a id="CHECKS-D105"></a>

### The usage page

The maintainer's private page on the Mini has one more view: how the website,
the downloads and the app are used, as charts. It reads; it collects nothing.
Every number on it is a total something already keeps and the privacy page
already names (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D7,
docs/app/keeping-work/privacy-and-telemetry.md#PRIV-84). One event was added
for it, on the maintainer's word of 2026-10-16: `copy_active`
(docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86), named on that page
with its reason like every other. Three more answer whether the tutorials are
used, on the maintainer's word of 2026-10-22: `tutorial_offered`,
`lesson_progress` and `lesson_stopped`
(docs/app/keeping-work/privacy-and-telemetry.md#PRIV-95). The page's
**Tutorials** figure draws them: the invitation shown and each answer to it,
with those shown and not answered as the difference; each lesson's starts,
continues and finishes; and the steps lessons were left at, most first. They
are counts of actions, like every event but `copy_active`, so the figure never
calls them writers or people. No other event, field, beacon or counter is
added to the app, the service or the website to feed it. One counter was
changed, on the maintainer's word of 2026-10-23: the update service counts
each file it serves by what it was (SERV-286), so the page tells a download
from the website or Homebrew from an update, and both from the project's own
machines.

**What it reads, each a fixed request with fixed parameters:**

| What | From | Its limits |
|---|---|---|
| Update checks by day, version, macOS and chip; every release file served, by what it was (SERV-286) | `update-use.sql`, `file-requests.sql` | A check is a copy asking, at launch and once a day while it runs, so a day's checks are roughly the copies in use: a copy opened twice is counted twice, and one with update checks switched off not at all. The monitor's own requests are subtracted and labelled |
| Launches, and every event and property value, by day | `usage-by-day.sql`, `launches-by-day.sql` | Releases and published betas only (SERV-272); an alpha sends none. Copies with usage reports switched off send none |
| Daily, weekly and monthly active copies; new against returning; Mac against Windows | `active-by-day.sql` | Exact for copies with usage reports on, from the first release that sends `copy_active`; before it, missing, never zero. A copy is counted under the version and system it ran when first counted in the period |
| Feedback messages per day | `feedback-counts.sql` | Counts only. A writer's words stay on the feedback page and nowhere else |
| Crash reports per day, and the top failures | Sentry, the three requests of CHECKS-D102 | As the weekly summary reads them; the country and city Sentry attaches are never read |
| The website's visits and page views by day, page, referring site, country, browser and device | Cloudflare Web Analytics, through its account analytics API (GraphQL, the `rumPageloadEventsAdaptiveGroups` dataset), filtered to the site's own hosts | Cloudflare samples it, and it counts only browsers that ran its beacon. It is the website's own total (PRIV-84); the app's services still count no country (SERV-143) |
| Downloads of each release's files | GitHub's public releases API for the public repository: each file's `download_count` | A running total with no dates. The page keeps each day's reading and draws the difference between days, so its history begins the day it first read |

**The credential.** The website's analytics need Account Analytics: Read on the
same Cloudflare read token the queries use: that token, widened, not a second
one. It stays read-only and is never the Worker deploy token (CHECKS-D102).
GitHub's release counts are public and take no token. A request that names the
service names it only as the monitor does (`User-Agent: proscenium-checks`),
and carries nothing of the maintainer's.

**What it says.** The rules of CHECKS-D103 hold on the page as in the reports:

- Counts are actions and approximate copies. No chart, table or tooltip counts
  people or unique anything: there is no identifier to count them by
  (SERV-66). "Copies in use" is a day's update checks; a visit is Cloudflare's
  estimate of one. Active copies from `active-by-day.sql` are the one unique
  count, as CHECKS-D103 allows: each copy deduplicates itself, so they are
  called "active copies", never people.
- **One estimate of real users, and it is called an estimate.** The maintainer
  asked for the nearest the counts can come to how many writers use the app,
  with the project's own machines taken away. The page gives one, labelled as
  an estimate wherever it appears, with how it was reached and what limits it
  beside it:
  - *What is taken away first*, from every chart on the page and not only the
    estimate: alpha builds, which run on the maintainer's own Macs alone; the
    monitor's own requests (CHECKS-D101); any version with no published
    release, since a test build was never anyone else's; and a release's
    version on days before its publication. What was taken away is said, with
    its size.
  - *The estimate*: update checks from published releases and betas, grouped
    by the kind of Mac that made them (macOS version and chip). Two kinds are
    certainly two Macs; within a kind, its busiest day says how many were in
    use at once. The estimate is each kind's busiest day, added together. The
    page gives beside it the least it can be (the kinds seen) and the most
    (every check a different Mac).
  - *What it cannot do*, said on the page: tell two days' checks from one Mac
    from one day's from two; see a copy with update checks switched off; or
    tell a release copy on one of the project's own machines from a writer's,
    because nothing a copy sends says whose it is. The website's visits and
    GitHub's download counts include the project's own, for the same reason.
  The reports (CHECKS-D103) are unchanged: they give no such estimate. Active
  copies (`active-by-day.sql`) stand beside the estimate once releases send
  them; the estimate stays, as the only count that reaches copies with usage
  reports switched off.
- **Unavailable is never zero.** A source that could not be read, a missing
  credential, or a day before a stream was collected is drawn as missing and
  says why. Only a day the source answered for, with no count, is a zero.
- A share over no launches is unavailable, not 0%. Actions can exceed 100 per
  100 launches.
- Days are UTC. Today is a part of a day and is labelled so.
- No model reads or writes any of it, and no feedback message appears on it.

**How it is kept.** One collector on the Mini makes the requests and writes one
file of totals beside the monitor's other state, outside any repository. The
daily check runs it, so each day has a reading; the page runs it again when its
file is older than fifteen minutes, and shows the file it has, with the reason,
when a request fails. The page is drawn on the Mini with no script and loads
nothing from anywhere, as its other views are.
