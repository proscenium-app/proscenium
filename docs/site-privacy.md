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
| A browser link you choose | releases, one release version, license or privacy | Open the page you requested. These links are not usage events. |

The failure kinds are `RustPanic` for a native panic and `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`, `InternalError`, `UnhandledRejection`, `PageError`, `AbortError`, `DataCloneError`, `InvalidStateError`, `NotFoundError`, `NotAllowedError`, `NotSupportedError`, `SecurityError`, `QuotaExceededError`, `NetworkError`, `TimeoutError`, `InvalidCharacterError`, `HierarchyRequestError`, `IndexSizeError` for a page failure. An unrecognized page failure uses `Error`.

The built-in format values are `dg-modern`, `stage-us-modern`, `stage-uk`, `samuel-french`, `dg-traditional`, `dg-musical`, `sketch-comedy`, and
`user` for every format you made. The error code values are `E-BOOT`, `E-FOLDER-OPEN`, `E-FOLDER-REFUSED`, `E-FOLDER-ACCESS`, `E-ICLOUD`, `E-PLAY-OPEN`, `E-PLAY-MISSING`, `E-PLAY-CREATE`, `E-SAVE`, `E-SAVE-LOCKED`, `E-SAVE-PERMISSION`, `E-SAVE-NOT-ALLOWED`, `E-SAVE-DISK-FULL`, `E-SAVE-READ-ONLY`, `E-SAVE-FOLDER-GONE`, `E-SAVE-UNREACHABLE`, `E-CHANGED-ON-DISK`, `E-VERSIONS`, `E-BINDER`, `E-ACTION-STALE`, `E-VAULT-READ`, `E-VAULT-PERMISSION`, `E-EXPORT-PDF`, `E-EXPORT-FONT`, `E-PRINT`, `E-FORMAT-READ`, `E-FORMAT-IMPORT`, `E-FORMAT-EXPORT`, `E-FORMAT-SAVE`, `E-FORMAT-TRASH`, `E-FORMATS-FOLDER`, `E-REVEAL`, `E-FINDER-OPEN`, `E-UPDATE-RESTART`, `E-WATCH`, `E-WORKSPACE`, `E-OTHER`.

There are no usage/session/user ids, exact play counts, location fields,
locale, device names, cookies, custom user-agent strings or writing in the
automatic reports. A network connection necessarily reveals an address to the
service that answers it. Cloudflare uses it for connection handling and brief
rate-limit buckets. Our Worker does not store it or derive an identifier from
it. It is not forwarded to Sentry. Sentry itself records a country and city
with each crash report, worked out from the address that delivers it: the
Cloudflare data centre that forwards the report, which is the one nearest you,
never your own address. Sentry adds this on arrival and offers no way to turn
it off; we do not use it. The independent GitHub updater fallback connects to
GitHub directly when the first endpoint fails.

The update service and daily counts run on Cloudflare. We keep daily totals
for two years, with no underlying request records. Usage batches wait only in
memory on the Mac and expire after seven days. Sentry receives the bounded
crash envelope through our service and keeps errors for its verified 30-day
lookback. Our Worker stores no copy of a crash. Locally, at most 20 crash files
remain until sent or replaced by newer records.

Feedback is kept in a private list on our Cloudflare service, and copied each
day to the Proscenium team's own computer for review. Both copies are deleted
after one year. Only the Proscenium team reads it, and it is never emailed or
forwarded. Your address is used only to reply to you. The app keeps one unsent
draft outside the Plays folder until a confirmed send or Discard Draft. It is
never sent in the background. Technical details are gathered fresh and are not
saved in the draft.

Settings > Privacy turns usage and crash reports off immediately and discards
queued reports. Update checks have their own switch. Feedback remains available
with both off. Opening or closing Feedback sends nothing. The page itself
makes no external requests; every app request leaves through Rust.

