# Privacy

Your plays and files stay on your Mac. Proscenium never collects your writing:
no play text, titles, character names, filenames or paths. Usage counts record
which features are used, never what you write with them. Send Feedback sends
only the words you choose to put in its form. Exporting, copying and sharing a
file do what you ask them to do. A Plays folder in a sync service and macOS
features such as Writing Tools, Services and Universal Clipboard follow their
own settings.

**Everything Proscenium collects, and why.** The table below is the complete
list of data that may leave your Mac; anything not in it is not collected. No
reason, no field. A test holds the table to the app's list of events and to our
service's, so neither can send something this page does not list.

| What is sent | Fields and allowed values | Why |
|---|---|---|
| Update check | platform `darwin`; chip `aarch64` or `x86_64`; current app version; macOS major/minor in `Proscenium-OS` | Find a compatible update and count how often copies of each version are used on each system. This is an estimate of copies, not a count of people. |
| Release download | release version and one of its own DMG, signed archive or signature filenames | Deliver the chosen release and count downloads by version. These are our release filenames, never yours. |
| Every usage batch | `version`, `platform`, `arch`, `os`, `channel` (`developer-id` or `app-store`) | See which releases, systems and delivery channels need support. |
| Usage batch shape | `events`: up to 25 items, each with `name` and `props` from the rows below | Group counts into fewer requests without identifying a session. |
| `app_launched` | no extra properties | Count how often the app opens each day. |
| `play_opened` | `plays`: `1`, `2-5`, `6-20`, `21+` | Guide work on the Plays screen without an exact play count. |
| `surface_shown` | `surface`: `script`, `board`, `outline`, `cast`, `changes`, `format-designer` | See which parts of the app get used and which need work. |
| `pdf_exported` | `kind`: `whole`, `range`, `sides`; `format`: `dg-modern`, `stage-us-modern`, `stage-uk`, `samuel-french`, `dg-traditional`, `dg-musical`, `sketch-comedy`, `user` | Decide which exports and built-in formats to improve. |
| `format_saved` | no extra properties | Know whether writers make their own formats. |
| `update_installed` | `from`: released version numbers; `to`: released version numbers | Check whether updates arrive and how far behind copies fall. |
| `error_shown` | `code`: `E-BOOT`, `E-FOLDER-OPEN`, `E-FOLDER-REFUSED`, `E-FOLDER-ACCESS`, `E-ICLOUD`, `E-PLAY-OPEN`, `E-PLAY-MISSING`, `E-PLAY-CREATE`, `E-SAVE`, `E-SAVE-LOCKED`, `E-SAVE-PERMISSION`, `E-SAVE-NOT-ALLOWED`, `E-SAVE-DISK-FULL`, `E-SAVE-READ-ONLY`, `E-SAVE-FOLDER-GONE`, `E-SAVE-UNREACHABLE`, `E-CHANGED-ON-DISK`, `E-VERSIONS`, `E-BINDER`, `E-ACTION-STALE`, `E-VAULT-READ`, `E-VAULT-PERMISSION`, `E-EXPORT-PDF`, `E-EXPORT-FONT`, `E-PRINT`, `E-FORMAT-READ`, `E-FORMAT-IMPORT`, `E-FORMAT-EXPORT`, `E-FORMAT-SAVE`, `E-FORMAT-TRASH`, `E-FORMATS-FOLDER`, `E-REVEAL`, `E-FINDER-OPEN`, `E-UPDATE-RESTART`, `E-WATCH`, `E-WORKSPACE`, `E-OTHER` | Fix the errors writers actually meet without collecting error messages. |
| One crash | `event_id`: a random UUID for that crash, repeated in the envelope | Let Sentry recognize a retry of the same crash. It does not identify a writer, device or session. |
| Crash context | `release`: app version; `platform`: javascript (omitted for native, the protocol default); `tags`: app platform, chip and macOS major/minor; `timestamp`: UTC day at midnight, as Unix seconds | Find the affected build and system, and the day it failed. No precise crash time leaves the Mac. |
| Crash failure | `level`: fatal; one `exception` with a kind from the closed list and a `stacktrace` | Group failures by where execution stopped. No exception message or value is allowed. |
| Each stack frame | `module`: native or webview; optional compiled `function`, `lineno`, `colno` | Locate the failing code. No filename, path, source line, memory address or local variable is sent. |
| Crash envelope | item `type`: event; byte `length`; event id | Give Sentry the format and size of its single crash event. No other item type is allowed. |
| Feedback | `id`: one random submission UUID; `message`: your text | Store the message once, including when a response is lost, and let you tell us what you need. |
| Optional feedback email | `email`: only when you enter it | Reply to you. It is not used for marketing or added to a usage or crash report. |
| Optional feedback details | The exact text under View Details, only when Include technical details is checked | Help understand the problem you are reporting. |
| Included diagnostic facts | app version/channel, chip, macOS version, accent, built-in format ids or `user`, default format, preference switches, sync-provider kind | Reproduce the setup that matters to your feedback. No play, user-format name, learned word or path appears. |
| Included diagnostic history | last 20 error codes with their local times/repeat counts; safe local crash summaries | Understand the failures you chose to show us. These precise local times appear only in details you inspect and include. |
| A browser link you choose | releases, one release version, license, support or privacy | Open the page you requested. These links are not usage events. |

The failure kinds are `RustPanic` for a native panic and `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`, `InternalError`, `UnhandledRejection`, `PageError`, `AbortError`, `DataCloneError`, `InvalidStateError`, `NotFoundError`, `NotAllowedError`, `NotSupportedError`, `SecurityError`, `QuotaExceededError`, `NetworkError`, `TimeoutError`, `InvalidCharacterError`, `HierarchyRequestError`, `IndexSizeError` for a page failure. An unrecognized page failure uses `Error`.

The built-in format values are `dg-modern`, `stage-us-modern`, `stage-uk`, `samuel-french`, `dg-traditional`, `dg-musical`, `sketch-comedy`, and
`user` for every format you made. The error code values are `E-BOOT`, `E-FOLDER-OPEN`, `E-FOLDER-REFUSED`, `E-FOLDER-ACCESS`, `E-ICLOUD`, `E-PLAY-OPEN`, `E-PLAY-MISSING`, `E-PLAY-CREATE`, `E-SAVE`, `E-SAVE-LOCKED`, `E-SAVE-PERMISSION`, `E-SAVE-NOT-ALLOWED`, `E-SAVE-DISK-FULL`, `E-SAVE-READ-ONLY`, `E-SAVE-FOLDER-GONE`, `E-SAVE-UNREACHABLE`, `E-CHANGED-ON-DISK`, `E-VERSIONS`, `E-BINDER`, `E-ACTION-STALE`, `E-VAULT-READ`, `E-VAULT-PERMISSION`, `E-EXPORT-PDF`, `E-EXPORT-FONT`, `E-PRINT`, `E-FORMAT-READ`, `E-FORMAT-IMPORT`, `E-FORMAT-EXPORT`, `E-FORMAT-SAVE`, `E-FORMAT-TRASH`, `E-FORMATS-FOLDER`, `E-REVEAL`, `E-FINDER-OPEN`, `E-UPDATE-RESTART`, `E-WATCH`, `E-WORKSPACE`, `E-OTHER`.

There are no usage/session/user ids, exact play counts, location fields,
locale, device names, cookies, custom user-agent strings or writing in the
automatic reports. Any connection shows your internet address to the service
that answers it. Our service uses it only while answering, to handle the
connection and limit abuse; it is not stored, turned into an identifier or
passed on. Sentry labels each crash report with an approximate country and
city, worked out from the server that passed the report on: one near you,
never your own address. We do not use that label. If our update service
cannot be reached, the app checks GitHub for updates instead, connecting to it
directly.

Our service runs on Cloudflare, and crash reports are stored with Sentry.
Both handle this data only on our behalf. Update checks, downloads and usage
counts are kept only as daily totals, for two years, with no record of any
single request. Crash reports are kept for 30 days, and our service keeps no
copy of them. On your Mac, unsent usage counts wait only in memory, for up to
seven days, and at most 20 crash records wait until they are sent or replaced
by newer ones.

Feedback is held privately and securely by the Proscenium team, and every
copy is deleted after one year. Only the team reads it, and it is never
forwarded or shared. Your address is used only to reply to you. The app keeps one unsent
draft outside the Plays folder until a confirmed send or Discard Draft. It is
never sent in the background. Technical details are gathered fresh and are not
saved in the draft.

Settings > Privacy turns usage and crash reports off immediately and discards
queued reports. Update checks have their own switch. Feedback remains available
with both off. Opening or closing Feedback sends nothing.

**This website** counts visits with Cloudflare Web Analytics: totals such as
the pages viewed, the site that sent you there and your country. It sets no
cookies, stores nothing in your browser and does not follow you from site to
site. A link you open from the app is an ordinary visit; the app itself sends
nothing to the website.

**Sponsors** give through GitHub Sponsors, and GitHub handles the payment; we
never see card details. GitHub tells us each sponsorship's amount and date and,
unless you sponsor privately, your public GitHub name. We keep that only to
thank you by name on this website and in the app's About. A private sponsor is
counted, never named. A monthly sponsor is removed when the sponsorship ends,
and a one-time gift after a year. The app never asks for the list: each release
carries it as it stood when that release was built. GitHub's own terms cover
what GitHub keeps and shows us.
