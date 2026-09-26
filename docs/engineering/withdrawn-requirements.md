# Withdrawn requirement ids

Archived during the documentation cleanup, 2026-09-21. This is an audit record, not the current contract.

<a id="STOR-26"></a>

**STOR-26 — Withdrawn.** The cleanup initially assigned this id to the editorial label “Rules:”. It imposed no independent obligation. The surrounding requirements retain their ids and meanings.

<a id="STOR-165"></a>

**STOR-165 — Withdrawn.** The cleanup initially assigned this id to the editorial label “That is the whole protocol.”. It imposed no independent obligation. The surrounding requirements retain their ids and meanings.

<a id="PRIV-33"></a>

**PRIV-33 — Withdrawn.** The initial allocation tagged the editorial introduction “Sources:”. Its following obligations retain their own ids; this label had no independent testable requirement.

<a id="EDIT-41"></a>

**EDIT-41 — Withdrawn.** The initial allocation tagged the editorial introduction “Two mechanics make this safe rather than cosmetic:”. Its following obligations retain their own ids; this label had no independent testable requirement.

<a id="EDIT-64"></a>

**EDIT-64 — Withdrawn.** The initial allocation tagged the editorial introduction “When the prediction is wrong:”. Its following obligations retain their own ids; this label had no independent testable requirement.

<a id="EDIT-82"></a>

**EDIT-82 — Withdrawn.** The initial allocation tagged the editorial introduction “Being the one doing the checking is what buys the rules that make it usable in a script:”. Its following obligations retain their own ids; this label had no independent testable requirement.

<a id="PLAT-21"></a>

**PLAT-21 — Withdrawn.** The initial allocation tagged the editorial introduction “Implementation notes worth keeping:”. Its following obligations retain their own ids; this label had no independent testable requirement.

<a id="STOR-112"></a>

**STOR-112 — Withdrawn.** Superseded by STOR-169 through STOR-173 during tutorial reconciliation, 2026-09-21. The legacy layout remains readable. Original contract:

 **Tutorial practice.** `<app data>/tutorials/practice/` holds ordinary play folders,
with the same manifests, Fountain files, guarded writes, recovery and Versions
as personal plays. A no-argument native command grants this app-owned directory;
the page cannot choose its path. Symlinked practice roots are refused. Starting,
resuming and leaving practice use the normal workspace settlement queue. Practice
never replaces `lastVault`, its bookmark, or `lastPlay`. Replay creates a new
play folder and retains every earlier attempt. The Help panel lists those attempts.
Tutorial metadata is separate in `tutorials/progress.json`, schema version 1,
written atomically under a native lock with an expected-content hash. It records
lesson and step IDs, outcomes and practice-folder identities, never keystrokes or
script text. Unknown or corrupt metadata is preserved and reported. Practice
files remain discoverable independently of that metadata. These files are
retained writing, not disposable cache; app-data deletion removes them.

<a id="STOR-114"></a>

**STOR-114 — Withdrawn.** Superseded by [STOR-175](../app/keeping-work/storage-and-file-format.md#STOR-175), which explicitly includes retained tutorial practice in the consequences of app-data deletion. Original contract:

On a sandboxed Mac this resolves inside the app's container. Deleting the
whole directory retains canonical files in the play folder, but loses local
history and any unsaved words whose only surviving copy is recovery data.

## Withdrawn 2026-09-22: CI/CD on the Mac mini and update tracks

The maintainer's decisions of 2026-09-22 replaced the pre-launch plan: no repository before launch, a matrix of hosted runners, signing on the maintainer's Mac, and a pull agent to the maintainer's MacBook. In its place, a private development repository's CI runs every gate and the native self-test on the maintainer's Mac mini, the build host, which also signs every build, and the ordinary updater delivers each green `main` as an alpha. Nothing runs on a paid plan. Each entry quotes the requirement as it stood.

<a id="REL-6"></a>

**REL-6 — Withdrawn 2026-09-22.** It read: “Acceptance: a CI-built app reports both architectures, launches natively on the Intel runner (not under Rosetta), and passes docs/release-engineering.md#REL-D4 there.” It named a GitHub-hosted Intel runner, and the maintainer ruled out hosted macOS runners for the native self-test. Replaced by [docs/ci-cd-and-update-tracks.md#CICD-38](#CICD-38), itself withdrawn on 2026-09-25.

<a id="REL-11"></a>

**REL-11 — Withdrawn 2026-09-22.** It read: “No repository before launch. It is created at launch, public, with the whole project as its one commit, and is open source from then on. So nothing in this section runs before launch, and a private repository's billing never applies. Until then each proof the matrix was to give comes from somewhere else:” The maintainer reversed it on 2026-09-22: a private repository now, and the public one still clean at launch. Replaced by a private development repository that holds the whole history, and a public repository whose `main` only a sync from it writes ([docs/engineering/release-engineering.md#REL-85](release-engineering.md#REL-85)).

<a id="REL-12"></a>

**REL-12 — Withdrawn 2026-09-22.** It read: “Every gate and the arm64 self-test: this Mac, before every merge (docs/release-engineering.md#REL-D4).” The gates and the self-test moved from this Mac, before every merge, to CI on the build host. Every push runs the gates, then the native self-test and its negative control, and a branch reaches `main` only once its run is green.

<a id="REL-13"></a>

**REL-13 — Withdrawn 2026-09-22.** It read: “Intel: the x86_64 slice under Rosetta on this Mac, and the Wave 3 launch on a real Intel Mac. The self-test app is self-contained, so that launch can be the self-test itself.” The Intel slice runs under Rosetta on the build host; the real Intel launch before release stands. Replaced by [docs/ci-cd-and-update-tracks.md#CICD-38](#CICD-38), itself withdrawn on 2026-09-25.

<a id="REL-14"></a>

**REL-14 — Withdrawn 2026-09-22.** It read: “The Sonoma floor: `check:webkit-floor` for the frontend. For the app, that Intel Mac, if it can be one still on Sonoma. The static frontend floor check does not prove a native launch on Sonoma.” The Sonoma floor's native proof now waits on a virtual machine or another Mac on Sonoma. Replaced by [docs/ci-cd-and-update-tracks.md#CICD-39](#CICD-39), itself withdrawn on 2026-09-25.

<a id="REL-15"></a>

**REL-15 — Withdrawn 2026-09-22.** It read: “At launch: the matrix runs for the first time. `macos-14` will probably be retired by then; it comes out of the matrix rather than failing it.” There is no hosted matrix to run at launch; the public repository's pull requests get the gates only, on GitHub's hosted runners, free for a public repository, with no secrets, and deciding nothing, because every change is checked again on the build host.

<a id="REL-16"></a>

**REL-16 — Withdrawn 2026-09-22.** It read: “`ci.yml` on every push and pull request, on `macos-15` (arm64): install with a frozen lockfile, then every gate — `bun test ./src`, `typecheck`, `check:layout`, `check:design`, `check:spdx`, `check:network`, `check:names`, `check:docs`, `check:webkit-floor`, `smoke`, `cargo test` — and `cargo clippy -- -D warnings` once the tree is clean of warnings (T5 may tighten it later).” The gates run on the build host's runner, not on `macos-15`, on every push.

<a id="REL-17"></a>

**REL-17 — Withdrawn 2026-09-22.** It read: “The native matrix, on the same triggers: build the universal app ad-hoc signed, then run the docs/release-engineering.md#REL-D4 self-test on” No hosted macOS runner runs the native self-test (the maintainer, 2026-09-22). Replaced by the self-test on the build host, behind its locked screen: the self-test build, which never ships, stands its own window in as the key window and turns off WebKit's occlusion detection and hidden-page timer throttling.

<a id="REL-18"></a>

**REL-18 — Withdrawn 2026-09-22.** It read: “`macos-14` — arm64, the floor;” The hosted Sonoma runner is gone from the design, and was retiring in any case. Replaced by [docs/ci-cd-and-update-tracks.md#CICD-39](#CICD-39), itself withdrawn on 2026-09-25.

<a id="REL-19"></a>

**REL-19 — Withdrawn 2026-09-22.** It read: “`macos-15-intel` — x86_64, the free Intel runner, and GitHub's last x86_64 image ;” The hosted Intel runner is gone from the design. Replaced by [docs/ci-cd-and-update-tracks.md#CICD-38](#CICD-38), itself withdrawn on 2026-09-25.

<a id="REL-20"></a>

**REL-20 — Withdrawn 2026-09-22.** It read: “`macos-26` — arm64, the current release .” The build host runs the current macOS itself. Replaced as [REL-17](#REL-17) is.

<a id="REL-21"></a>

**REL-21 — Withdrawn 2026-09-22.** It read: “Cache Cargo and Bun between runs. Upload the self-test screenshots as artifacts, so a failure on Intel can be looked at.” Caches persist on the build host, and the evidence is kept with each run as its artifacts.

<a id="REL-22"></a>

**REL-22 — Withdrawn 2026-09-22.** It read: “Acceptance: a pull request shows the gates and all three native jobs, and the workflow badge is green on main.” Its three native jobs were hosted runners. Replaced by the gates green on `main` in the build host's pipeline, shown on each pull request, and the native self-test accepted on the locked build host: three clean passes on `main` in a row, the negative control caught on the collapsed frame, snapshots of the real surfaces kept, and the host left as it was.

<a id="REL-30"></a>

**REL-30 — Withdrawn 2026-09-22.** It read: “Acceptance: a test that breaks a `flex` rule fails on all three runners in the real WebKit, and the release build has no `selftest` symbols.” It asked for the negative control on three hosted runners; it runs on the build host now. The release build's lack of self-test symbols stays docs/release-engineering.md#REL-29. Replaced by the self-test's acceptance on the build host, as for [REL-22](#REL-22).

<a id="REL-49"></a>

**REL-49 — Withdrawn 2026-09-22.** It read: “One release script, run on [the maintainer's] Mac. With no repository before launch (docs/release-engineering.md#REL-D3), every signed build before launch — the enrollment-day proof, the 0.9.x candidates — has to be made on [the maintainer's] Mac. So the pipeline is `scripts/release.mjs`, and `release.yml` is that script run with Actions secrets. On the Mac, the certificate and its key sit in the login keychain, where Xcode creates them, and the notarization key and updater key are keychain items that `scripts/release-keychain.mjs` and `scripts/updater-keygen.mjs` put there without printing them. Whether releases after launch move to Actions is [the maintainer's] call then; nothing needs rewriting either way. The Actions contract follows.” Signed builds are made on the build host from its own keychain, not on the maintainer's Mac: a stable tag builds, signs, notarizes and checks the release there with `scripts/release.mjs`.

<a id="REL-50"></a>

**REL-50 — Withdrawn 2026-09-22.** It read: “`release.yml` on a `v*` tag, on `macos-15`:” `release.yml` runs on the build host. Replaced by `tagged-release.yml`, on `v*` tags, on the build host's runner: a `-beta.N` tag publishes a beta, and a plain `vX.Y.Z` tag runs `release.mjs`, signing from the host keychain.

<a id="REL-51"></a>

**REL-51 — Withdrawn 2026-09-22.** It read: “`tauri-action` builds universal and signs with `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` and `APPLE_SIGNING_IDENTITY`.” The workflow never used tauri-action: it runs `scripts/release.mjs`, which now signs from the build host's keychain, with the Actions secrets as a redundant copy that no runner reads.

<a id="REL-52"></a>

**REL-52 — Withdrawn 2026-09-22.** It read: “It notarizes with an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, and the `.p8` written to `APPLE_API_KEY_PATH` from a secret), then staples the app and the DMG.” Notarization uses the key in the build host's keychain.

<a id="REL-53"></a>

**REL-53 — Withdrawn 2026-09-22.** It read: “It produces `latest.json` with the updater signatures (docs/release-engineering.md#REL-D6) and drafts a GitHub Release. A human publishes the draft.” What a stable tag produces, and when it is drafted, is now stated with the public repository's launch: until then a stable tag's run keeps the release's files as its artifacts and publishes nothing, and from launch it drafts the release on the public repository.

<a id="REL-58"></a>

**REL-58 — Withdrawn 2026-09-22.** It read: “`tauri-plugin-updater`, with the endpoint `latest.json` on GitHub Releases and the public key in `tauri.conf.json`.” Copies now ask a track's address on updates.proscenium.ink, with GitHub's `latest.json` as stable's fallback only. The plugin and the public key in tauri.conf.json are unchanged. Replaced by [docs/services-and-feedback.md#SERV-246](services-and-feedback.md#SERV-246) and [docs/services-and-feedback.md#SERV-D1](services-and-feedback.md#SERV-D1).

<a id="REL-59"></a>

**REL-59 — Withdrawn 2026-09-22.** It read: “The key. `tauri signer generate`, run while [the maintainer] is present, writing the private key to a file he moves into 1Password at once, with a second backup. In CI it is `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The key is never committed and never printed. For releases made on [the maintainer's] Mac it is also an item in the login keychain.” No password manager holds it (the maintainer, 2026-09-22). Its copies are the maintainer's, kept outside this repository.

<a id="MINI-4"></a>

**MINI-4 — Withdrawn 2026-09-22.** It read: “A merged change reaches the MacBook politely. It lands in `/Applications` with no agent session running on the MacBook, and it never comes to the front. It waits while a call is on, while Proscenium is the front app or has unsaved words, and while `lastVault` is not [the maintainer's] Plays folder. If the app was running, it reopens behind his windows; if it was not, it stays closed.” The pull agent was withdrawn unbuilt; the ordinary updater brings each green main, and the restart is the maintainer's.

<a id="MINI-5"></a>

**MINI-5 — Withdrawn 2026-09-22.** It read: “The agent can say whether [the maintainer] has it. A receipt says which build the MacBook installed and when, or what it is waiting for.” There is no pull agent to write a receipt. Settings › Updates names the version a copy runs, and each run records what it published.

<a id="MINI-7"></a>

**MINI-7 — Withdrawn 2026-09-22.** It read: “The Mini never opens [the maintainer's] plays and holds no signing material.” The Mini holds the signing material now, in its own keychain. Its other half stands: the Mini never opens the maintainer's plays.

<a id="MINI-8"></a>

**MINI-8 — Withdrawn 2026-09-22.** It read: “One repository. Main lives on the Mini. Nothing commits anywhere else.” Main lives on GitHub, in the private development repository, which both Macs push to.

<a id="MINI-9"></a>

**MINI-9 — Withdrawn 2026-09-22.** It read: “An in-progress build can be tried beside the real app without touching the real app's settings, its Plays folder or its data.” Proscenium Dev was withdrawn unbuilt; the in-progress build the maintainer uses is the alpha, which the ordinary updater brings from every green `main`.

<a id="SERV-110"></a>

**SERV-110 — Withdrawn 2026-09-22.** It read: “A deploy token scoped to Workers on this zone, filed in the login keychain like the signing material (`release-keychain.mjs`), and used only by `wrangler`.” The token also needs R2 on the one bucket the tracks are published to, and is filed in the build host's keychain too. Replaced by SERV-244, which was withdrawn the same day (below), and then by [docs/services-and-feedback.md#SERV-251](services-and-feedback.md#SERV-251).

<a id="SERV-244"></a>

**SERV-244 — Withdrawn 2026-09-22.** It read: “A deploy token scoped to Workers on this zone and to R2 object read and write on the `proscenium-updates` bucket, nothing wider. It is filed in the login keychain and the build host's keychain like the signing material (`release-keychain.mjs`), and used only by `wrangler`.” The maintainer ruled out a new or scoped token: the existing token gains R2. Replaced by [docs/services-and-feedback.md#SERV-251](services-and-feedback.md#SERV-251).

<a id="CICD-21"></a>

**CICD-21 — Withdrawn 2026-09-22.** It read: “The Cloudflare token gains R2 on that bucket, and nothing wider.” The maintainer ruled out a new or scoped token: the existing token gains R2. Replaced by [docs/services-and-feedback.md#SERV-251](services-and-feedback.md#SERV-251).

## Withdrawn 2026-09-22: the guide at the work

The tutorials needed to show the writer where to type and how, to notice by themselves whether an instruction was followed, and to write one play across all lessons ([docs/tutorials.md#TUT-D100](../app/preferences-and-help/tutorials.md#TUT-D100)).

<a id="STOR-169"></a>

**STOR-169 — Withdrawn 2026-09-22.** Replaced by [STOR-176](../app/keeping-work/storage-and-file-format.md#STOR-176) when every lesson came to write one practice play ([TUT-10](../app/preferences-and-help/tutorials.md#TUT-10)). Practice written under it stays readable and is listed in Saved Practice. Original contract:

 Tutorial practice is retained writing under app data, outside the Plays folder. Native code derives its root; callers supply only a validated session ID. Every new attempt reserves an exclusive directory at `tutorials/sessions/<sessionId>/Practice Play/` and receives a new play identity. Symlinks and path escapes are refused. Ordinary editor, manifest, note, recovery and Versions writers operate within that grant. Starting again, demonstrating and skipping ahead preserve earlier attempts. Deleting app data deletes practice; it is not a backup.

<a id="TUT-3"></a>

**TUT-3 — Withdrawn 2026-09-22.** Replaced by [TUT-8](../app/preferences-and-help/tutorials.md#TUT-8): the guide is a card at the control or line the step is about, not a panel of text beside the writing. Original contract:

 The guide stays beside the writing and explains the current action.

## Withdrawn 2026-09-24: Pages imports directly

A `.pages` document needed to import directly ([docs/app/importing/document-import.md#IMPT-D12](../app/importing/document-import.md#IMPT-D12)). Pages' Word export stays, as the route for the documents the reader refuses.

<a id="IMPT-15"></a>

**IMPT-15 — Withdrawn 2026-09-24.** Replaced by [IMPT-91](../app/importing/document-import.md#IMPT-91): the Word export is now the fallback, named where a document is refused, rather than the way in. Original contract:

 Pages exports Word documents directly. Make the path visible when choosing a file and repeat it when a `.pages` file is selected. This is an export route, not native Pages parsing. [Apple's Pages export guide](https://support.apple.com/en-gb/guide/pages/tance1161f26/mac).

<a id="IMPT-19"></a>

**IMPT-19 — Withdrawn 2026-09-24.** Replaced by [IMPT-87](../app/importing/document-import.md#IMPT-87) and [IMPT-88](../app/importing/document-import.md#IMPT-88), the direct route and its fidelity boundary. Original support-matrix row:

 | Pages | File → Export To → Word | Native `.pages` packages are not parsed. |

<a id="EDIT-63"></a>

**EDIT-63 — Withdrawn 2026-09-25.** Replaced by [EDIT-170](../app/writing/editor-ux.md#EDIT-170), what the element bar holds, and [EDIT-171](../app/writing/editor-ux.md#EDIT-171), how it fits a narrow pane. The palette it described was deleted because Tab, `;` and each element's ⌘⌥ chord already reach every element. Original contract:

> **The element bar rests compact.** It shows the element you are in, B/I/U, the two breaks, and the page count in one row; a chevron expands the full element palette, and that choice persists. Every element type is already on Tab, on `;`, and on its ⌘⌥ chord.

## Withdrawn 2026-09-25: no human pass

The maintainer, 2026-09-25: "There's never going to be a human pass. Find your way around it." Each gate that waited on a person using the app is replaced by a machine proof or withdrawn with the claim it supported, and the release record lists each one.

<a id="A11Y-1"></a>

**A11Y-1 — Withdrawn 2026-09-25.** It read: “Full keyboard use, VoiceOver, Voice Control, Increase Contrast, Reduce Motion and Reduce Transparency are requirements of this system, not a pass made over it.” VoiceOver and Voice Control were to be proven by a person using them. Replaced by [A11Y-18](../app/preferences-and-help/accessibility.md#A11Y-18), which holds the accessibility tree they read, by machine.

<a id="A11Y-14"></a>

**A11Y-14 — Withdrawn 2026-09-25.** It read: “`bun run smoke` runs axe-core against WCAG 2.2 A and AA on every surface it opens, in both schemes, and fails on a serious or critical finding; best-practice advice is printed and does not fail. It also presses the keys the rules above promise. Neither replaces a pass with VoiceOver on the real WKWebView: smoke is Chromium, and WebKit's accessibility tree is its own.” The VoiceOver pass it deferred to will not run. Replaced by [A11Y-15](../app/preferences-and-help/accessibility.md#A11Y-15) (smoke in Chromium and WebKit, with the tree held), [A11Y-16](../app/preferences-and-help/accessibility.md#A11Y-16) (WebKit's own tree in the real app) and [A11Y-17](../app/preferences-and-help/accessibility.md#A11Y-17) (what may be claimed).

<a id="REL-1"></a>

**REL-1 — Withdrawn 2026-09-25.** It read: “The release contract: one universal Proscenium that launches correctly on every Mac from Sonoma up, Apple silicon and Intel alike; proven on those Macs by CI rather than by inference; signed, notarized and self-updating.” No machine this project uses can launch it on Sonoma or on Intel hardware. Replaced by [REL-122](#REL-122), itself withdrawn on 2026-09-26, which says what is proven and what is not.

<a id="CICD-37"></a>

**CICD-37 — Withdrawn 2026-09-25.** It read: “Plan B, only if A cannot be made trustworthy, and only after asking [the maintainer], because of the disk. A macOS virtual machine on the Mini (tart), never locked, started by the job and stopped after it. It would also give the Sonoma floor a real native run.” Its last sentence is false on the Mini: an M4 Pro cannot boot a macOS older than Sequoia 15.1 as a guest. Replaced by the same plan B without that sentence: a virtual machine only if the locked-screen self-test cannot be made trustworthy, and never a Sonoma run.

<a id="CICD-38"></a>

**CICD-38 — Withdrawn 2026-09-25.** It read: “The Intel slice runs under Rosetta on the Mini, already installed there (verified 2026-09-22), or inside the plan B machine. A real launch on [the maintainer's] Intel Mac still happens before a release (docs/engineering/release-engineering.md#SHIP-D109): Rosetta is not an Intel Mac.” The real-Mac launch was a person's. Replaced by the Rosetta run, launch to export, as the Intel proof, with its limit stated: a fault only Intel hardware shows is not covered.

<a id="CICD-39"></a>

**CICD-39 — Withdrawn 2026-09-25.** It read: “The Sonoma floor. `check:webkit-floor` proves the frontend on every run. A native launch on Sonoma needs plan B's machine or one of [the maintainer's] other Macs running Sonoma, in the pass before release. Until one of those exists, the native half of docs/engineering/release-engineering.md#REL-1 for Sonoma is not proven by CI, and the release record says so.” Neither machine is coming: plan B cannot host Sonoma on the Mini, and no other Mac is used. Replaced by the static proof alone: `check:webkit-floor` on every run, a native half that is stated as unproven, and no release waiting on it.

<a id="SERV-129"></a>

**SERV-129 — Withdrawn 2026-09-25.** It read: “Launch day. The 0.9.x copy on the second account updates to 1.0.0 through `updates.proscenium.ink`. With that host blocked, it updates through GitHub.” A person drove the second account. Replaced by [SERV-260](#SERV-260), itself withdrawn on 2026-09-26.

<a id="SHIP-D7-second-account"></a>

**The release procedure's second-account iCloud check — withdrawn 2026-09-25** ([release-engineering.md#SHIP-D7](release-engineering.md#SHIP-D7)). It read, for the maintainer: on a second macOS account signed into iCloud, open the DMG from `/Users/Shared`, drag Proscenium into that account's own Applications folder, open it, and check that it launches with no warning, that the Welcome screen offers “iCloud Drive”, and that Finder shows iCloud Drive › Proscenium; then tell the agent. Replaced by file checks with no window touched: the entitlements, the public container in the Info.plist, and the resolved, synced container on a Mac where the signed alpha runs.

<a id="SHIP-D104-step-8"></a>

**Launch day, steps 5 and 8 — withdrawn 2026-09-25** ([release-engineering.md#SHIP-D104](release-engineering.md#SHIP-D104)). Step 5 read: “Agent: make sure a signed 0.9.x from before launch is installed on the second account from setup step 7. Step 8 needs it.” Step 8 read: “[The maintainer], on the second account: open the 0.9.x copy, open a play, type a line, then Settings › Updates → Check Now → Restart to Update. It comes back as 1.0.0. The line you typed is in the play. This is the first update through the real address; do it before telling anyone about the release.” Replaced by the Stable update proof ([release-engineering.md#SHIP-D104](release-engineering.md#SHIP-D104), step 8): a workflow on the build host that updates a copy of the previous release through the real address and reads back the line it typed.

<a id="SHIP-D109-step-7"></a>

**Every release, step 7 — withdrawn 2026-09-25** ([release-engineering.md#SHIP-D109](release-engineering.md#SHIP-D109)). It read: “[The maintainer], for 1.0.0 and for any release that changes signing, entitlements or the updater: the second-account check from setup step 7.” Replaced by setup step 7's file checks and the Stable update proof.

## Withdrawn 2026-09-25: alpha behind a key

The maintainer made the alpha track his own: "I want to limit who can access alpha, and then have stable and beta as options."

<a id="SET-31"></a>

**SET-31 — Withdrawn 2026-09-25.** Replaced by [SET-37](../app/preferences-and-help/settings.md#SET-37), the tracks a writer is offered, [SET-38](../app/preferences-and-help/settings.md#SET-38), the key, and [SET-39](../app/preferences-and-help/settings.md#SET-39), alpha without one. Original contract:

> **Updates › Update track** — Stable (the default), Beta or Alpha, each with one plain sentence saying what arrives on it. A note says, only while it is true, that moving to a slower track waits for that track to pass the version already installed, because Proscenium never installs an older one. The setting is `updateTrack` in `settings.json`; what each track is and what a change of track does is [the CI/CD plan's Tracks].

## Withdrawn 2026-09-26: the update proof, from 1.0.0 on

The update proof could not start from a copy that was already built. A release build takes no input but a person's, and the route that would have driven one was not taken. So the proof builds the version updated from out of its own tag, and it can prove only from a version that carries it, 1.0.0 and later. Each requirement below counted the launch-day update, 0.9.x to 1.0.0, as proven.

<a id="CICD-58"></a>

**CICD-58 — Withdrawn 2026-09-26.** It read: “**"Stable update proof": the update a writer's copy makes, made by the build host.** A `workflow_dispatch` workflow on the Mini's runner, behind the lock and inside the self-test's bench, takes a from-version and a to-version. It puts a copy of the from-version in a scratch location under a scratch HOME whose `settings.json` turns reports off, so the launch is not counted. It opens a scratch play, types a line through the harness, and presses Check Now and then Restart to Update against the real `updates.proscenium.ink`. It passes only when the copy comes back as the to-version, notarized and running, with the line in the play. It runs against stable on launch day, and against the alpha track before then. It replaces the second-account update check of docs/engineering/release-engineering.md#SHIP-D104 and docs/engineering/release-engineering.md#SHIP-D109.” Replaced by the same workflow, which builds the version updated from out of its own tag and so proves only from 1.0.0 on, and not on alpha, whose one key stays on the maintainer's Mac.

<a id="SERV-260"></a>

**SERV-260 — Withdrawn 2026-09-26.** It read: “**Launch day.** The Stable update proof ([release-engineering.md#SHIP-D104](release-engineering.md#SHIP-D104), step 8) updates a copy of the last 0.9.x to 1.0.0 through `updates.proscenium.ink`. The updater's way to GitHub with that host unreachable is proven by its native tests and the rehearsal that ran it headless. It replaces SERV-129 (docs/engineering/withdrawn-requirements.md#SERV-129), which a person ran on a second macOS account.” Replaced by [SERV-264](services-and-feedback.md#SERV-264).

<a id="REL-122"></a>

**REL-122 — Withdrawn 2026-09-26.** It read: “**The release contract:** one universal Proscenium, meant to launch correctly on every Mac from Sonoma up, Apple silicon and Intel alike; signed, notarized and self-updating. What is proven, and by what, is the machine's alone, and no release waits on a person: the frontend against the floor's Safari on every run (`check:webkit-floor`); the native app on the build host's macOS on Apple silicon, and its Intel slice under Rosetta, launch to export; the update itself on the build host, by the Stable update proof (launch day, step 8). A native launch on Sonoma and a launch on Intel hardware are not proven, because no machine this project uses can give either, and the release record says so. This replaces REL-1 (docs/engineering/withdrawn-requirements.md#REL-1), whose "proven on those Macs by CI" no machine this project uses can give for Sonoma or Intel hardware.” Replaced by [REL-123](release-engineering.md#REL-123).

## Withdrawn 2026-09-25: importing into an open play

The maintainer, 2026-09-25: "import off of the plays page to make a new play, import within a play to make a binder or a new script or whatever. So two functions." Import on the Plays screen still makes a play; inside a play it adds a script or a binder document to that play ([docs/app/importing/document-import.md#IMPT-D13](../app/importing/document-import.md#IMPT-D13)).

<a id="IMPT-1"></a>

**IMPT-1 — Withdrawn 2026-09-25.** Replaced by [IMPT-93](../app/importing/document-import.md#IMPT-93). Original contract:

 Import reads local source files, presents a correctable interpretation, and creates a new play only on confirmation.

<a id="IMPT-6"></a>

**IMPT-6 — Withdrawn 2026-09-25.** Replaced by [IMPT-94](../app/importing/document-import.md#IMPT-94). Original contract:

 Nothing is written until **Create New Play**.

<a id="IMPT-7"></a>

**IMPT-7 — Withdrawn 2026-09-25.** Replaced by [IMPT-101](../app/importing/document-import.md#IMPT-101). Original contract:

 The import creates a separate play. It does not append to or replace an open script, and never overwrites an existing file.

<a id="IMPT-37"></a>

**IMPT-37 — Withdrawn 2026-09-25.** Replaced by [IMPT-96](../app/importing/document-import.md#IMPT-96). Original contract:

 The destination is the current Plays folder, displayed in review. Choosing the folder remains the existing onboarding/Settings action. Import does not quietly switch it. A Finder request waits until a Plays folder exists.

<a id="IMPT-39"></a>

**IMPT-39 — Withdrawn 2026-09-25.** Replaced by [IMPT-102](../app/importing/document-import.md#IMPT-102). Original contract:

 Heading: **Import a Draft**. Subtitle: **Review your draft before creating a play.**

<a id="IMPT-50"></a>

**IMPT-50 — Withdrawn 2026-09-25.** Replaced by [IMPT-97](../app/importing/document-import.md#IMPT-97). Original contract:

 Editable **New play name**; visible Plays folder; **Choose Different Files…**.

<a id="IMPT-55"></a>

**IMPT-55 — Withdrawn 2026-09-25.** Replaced by [IMPT-99](../app/importing/document-import.md#IMPT-99). Original contract:

 Fixed footer: the create/copy consequence, Cancel, optional Skip This File, and **Create New Play**.
