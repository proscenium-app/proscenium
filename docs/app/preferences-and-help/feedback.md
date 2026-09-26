# Send Feedback

[Preferences and help](README.md) › Send Feedback

The feedback feature lets a writer review and send a message, retain an unfinished draft, and see whether delivery succeeded.

[Form](#FEED-D2) · [Sending](#FEED-D3) · [Draft](#FEED-D4) · [Privacy](#FEED-D5) · [Acceptance](#FEED-D7)

## Requirements

<a id="FEED-D100"></a>

### Send Feedback

<a id="SERV-144"></a>

**SERV-144** Feedback is stored in a private list. The service sends no notice or email.

<a id="FEED-D1"></a>

### What it is

<a id="SERV-145"></a>

**SERV-145** Feedback opens a compact **Send Feedback** sheet. Writers can share an idea,
describe something frustrating, ask a question, or say anything else in their
own words.

<a id="SERV-146"></a>

**SERV-146** The toolbar's Feedback button, Help menu, and Settings entry all open the same
form.

<a id="FEED-D2"></a>

### The form

| Element | Specification | Requirement |
|---|---| --- |
| **Your feedback** | Large, empty text area. The only required field. Hint: "What would you like us to know?" | <a id="SERV-147"></a>SERV-147 |
| **Email (optional)** | Single-line field underneath. Helper: "Leave your email if you'd like a reply." | <a id="SERV-148"></a>SERV-148 |
| **Include technical details** | Optional checkbox, off by default. Helper: "App version, system information, and recent errors." A **View Details** disclosure shows exactly what would be included. | <a id="SERV-149"></a>SERV-149 |
| **Footer** | **Close** and **Send Feedback**. Small note: "Your message goes privately to the Proscenium team." | <a id="SERV-150"></a>SERV-150 |

<a id="SERV-151"></a>

**SERV-151** The message field gets most of the space and receives focus immediately. Use
the app's normal interface font, familiar controls, current appearance, and
chosen accent. "Light" means a short, quiet form; it follows the writer's light
or dark preference.

<a id="SERV-152"></a>

**SERV-152** The form accepts plain text with paragraphs, pasted content, and Unicode. There
is no required subject, category, rating, or bug-report template. Allow up to
10,000 characters, show a count near the limit, and never silently truncate
pasted text.

<a id="FEED-D3"></a>

### Sending

- <a id="SERV-153"></a> **SERV-153** **Ready:** Send becomes available when the message contains something beyond
  whitespace. Validate email only if provided.
- <a id="SERV-154"></a> **SERV-154** **Writing:** Return inserts a newline. Command-Return sends. Standard keyboard
  navigation and screen-reader labels work throughout.
- <a id="SERV-155"></a> **SERV-155** **Sending:** The button reads "Sending…" and prevents duplicate submissions.
- <a id="SERV-156"></a> **SERV-156** **Success:** After confirmed receipt, clear the draft, close the sheet, and
  announce "Feedback sent. Thank you."
- <a id="SERV-157"></a> **SERV-157** **Failure or offline:** Keep everything the writer entered. Show an inline
  explanation with **Try Again** and **Copy Message**. Never claim success
  without confirmation.

<a id="FEED-D4"></a>

### The draft

<a id="SERV-158"></a>

**SERV-158** Closing the sheet or pressing Escape saves one local draft. Reopening restores
it, including after an app restart. Keep that draft in app data, outside the
Plays folder. Clear it after successful submission or an explicit **Discard
Draft** action. An unsent draft is never submitted automatically.

<a id="FEED-D5"></a>

### Technical details and privacy

<a id="SERV-159"></a>

**SERV-159** Technical details stay secondary. Feedback must still work if diagnostics
cannot be collected. No play text, titles, filenames, or paths are attached
automatically. Send only the message, optional email, and technical details the
writer explicitly includes. Manual feedback remains available when anonymous
analytics is switched off.

<a id="FEED-D6"></a>

### Delivery

<a id="SERV-160"></a>

**SERV-160** Delivery happens inside the app, without an account or browser handoff. This
requires a small feedback service that accepts submissions into a private
inbox. Requests go through the app's native network layer, with duplicate
protection for retries. The receiving service and inbox need to be configured
before shipping, and the network allowlist and privacy documentation updated.

<a id="FEED-D7"></a>

### Acceptance

<a id="SERV-161"></a>

**SERV-161** The acceptance test is simple: a writer can open Feedback, type "I wish the
binder remembered its width," and send it without completing another field.
Failed sends preserve their words, optional diagnostics remain inspectable, and
the whole flow works with the keyboard, both appearances, and enlarged
interface text.

<a id="FEED-D8"></a>

### In this app

<a id="SERV-162"></a>

**SERV-162** **What it replaces.**
- <a id="SERV-163"></a> **SERV-163** Help › **Report a Problem…** becomes Help › **Send Feedback…** (`menu.rs`,
  id `report-problem`).
- <a id="SERV-164"></a> **SERV-164** Settings › About's **Report a Problem…** becomes **Send Feedback…**.
- <a id="SERV-165"></a> **SERV-165** `src/diagnostics/ReportProblemSheet.tsx` and its GitHub handoff go, and
  `NEW_ISSUE` leaves the allowlist ([the address contract](../../engineering/services-and-feedback.md#SERV-D1)).
- <a id="SERV-166"></a> **SERV-166** Help › **Copy Diagnostics** stays.

<a id="SERV-167"></a>

**SERV-167** **Where it lives.**
- <a id="SERV-168"></a> **SERV-168** **The sheet:** `src/feedback/`.
- <a id="SERV-169"></a> **SERV-169** **The toolbar button:** in `.toolbar__right`, labelled **Feedback**, following
  DESIGN.md's toolbar anatomy.
- <a id="SERV-170"></a> **SERV-170** **The Rust client and draft store:** beside `telemetry/diagnostics.rs`, but
  outside telemetry. Feedback is not a report, and the analytics switch does
  not touch it.

<a id="SERV-171"></a>

**SERV-171** **The sheet.**
- <a id="SERV-172"></a> **SERV-172** **Built on `ui/Sheet.tsx`,** so `ui/layers.ts` owns Escape and focus.
  - <a id="SERV-173"></a> **SERV-173** The message field takes focus once the sheet owns its layer. That is the
    pattern ReportProblemSheet uses when it opens over Settings.
  - <a id="SERV-174"></a> **SERV-174** Close and Escape save the draft (docs/app/preferences-and-help/feedback.md#FEED-D4), then close.
- <a id="SERV-175"></a> **SERV-175** **Keys:**
  - <a id="SERV-176"></a> **SERV-176** ⌘⏎ sends from anywhere in the sheet.
  - <a id="SERV-177"></a> **SERV-177** ⏎ in the message inserts a newline.
  - <a id="SERV-178"></a> **SERV-178** ⏎ in the email field does nothing, so it can never send by accident.
- <a id="SERV-179"></a> **SERV-179** **Screen readers:**
  - <a id="SERV-180"></a> **SERV-180** Every field has a visible label, and each helper is tied to its field by
    `aria-describedby`.
  - <a id="SERV-181"></a> **SERV-181** The count is announced only as the message nears the limit.
  - <a id="SERV-182"></a> **SERV-182** Success and an inline failure both speak through `ui/announce.ts`
    (AGENTS.md: anything that changes without focus speaks).
- <a id="SERV-183"></a> **SERV-183** **Design:** DESIGN.md's type sizes, radius and accent tokens, which
  `check:design` holds.
- <a id="SERV-184"></a> **SERV-184** **At 200% interface text** (Settings › Appearance), the sheet scrolls rather
  than clipping, and the footer stays reachable.
- <a id="SERV-185"></a> **SERV-185** **Discard Draft** appears in the footer, to the left, whenever the fields hold
  anything.

<a id="SERV-186"></a>

**SERV-186** **Counting characters.**
- <a id="SERV-187"></a> **SERV-187** The count is characters as the writer sees them (grapheme clusters,
  `Intl.Segmenter`). It shows from 9,000.
- <a id="SERV-188"></a> **SERV-188** Past 10,000, the pasted text stays whole and the count turns to its warning
  colour. Send stays unavailable and says why: "Shorten your message to 10,000
  characters to send." Nothing is ever cut.

<a id="SERV-189"></a>

**SERV-189** **The draft.**
- <a id="SERV-190"></a> **SERV-190** **Where:** one file, `feedback-draft.json`, in the app's data directory.
  - <a id="SERV-191"></a> **SERV-191** It is written the way every write is: temp file, `fsync`, rename.
  - <a id="SERV-192"></a> **SERV-192** It is never in the Plays folder.
- <a id="SERV-193"></a> **SERV-193** **What it holds:** the message, the email, and the checkbox. Never the
  technical details, which are gathered fresh.
- <a id="SERV-194"></a> **SERV-194** **When it is saved:** on Close or Escape, if any field holds something. An
  empty form deletes the draft.
- <a id="SERV-195"></a> **SERV-195** **When it is cleared:** on a confirmed send, or on Discard Draft.

<a id="SERV-196"></a>

**SERV-196** **Technical details.**
- <a id="SERV-197"></a> **SERV-197** **The text:** exactly what Help › Copy Diagnostics produces
  (`telemetry/diagnostics.rs`).
  - <a id="SERV-198"></a> **SERV-198** It already leaves out paths, play names, format names and learned words.
  - <a id="SERV-199"></a> **SERV-199** Its test places a play at a known path to prove it.
- <a id="SERV-200"></a> **SERV-200** **View Details** shows that text, read-only. The string shown is the string
  sent.
- <a id="SERV-201"></a> **SERV-201** **If it cannot be gathered,** the checkbox is unavailable with a one-line
  reason, and the message still sends.

<a id="SERV-202"></a>

**SERV-202** **The request.**
- <a id="SERV-203"></a> **SERV-203** **From the native layer:** a Rust command posts to
  `https://feedback.proscenium.ink/v1/messages`, over reqwest, with no
  user-agent and no cookies.
- <a id="SERV-204"></a> **SERV-204** **The body:** `{ id, message, email?, details? }`. The optional fields appear
  only when the writer supplied them.
- <a id="SERV-205"></a> **SERV-205** **Duplicate protection:**
  - <a id="SERV-206"></a> **SERV-206** The id is a random UUID, made the first time Send is pressed for this
    draft, and saved with the draft.
  - <a id="SERV-207"></a> **SERV-207** Try Again, a relaunch, or a lost answer all repeat the same id, and the
    service stores each id once.
- <a id="SERV-208"></a> **SERV-208** **Success** is a 201 whose body echoes the id. Anything else is a failure.
- <a id="SERV-209"></a> **SERV-209** **Timeout:** 30 seconds, then the failure state.

<a id="SERV-210"></a>

**SERV-210** **Failure wording,** each shown inline with Try Again and Copy Message:
- <a id="SERV-211"></a> **SERV-211** **Offline:** "You're offline. Your message is saved here; try again once
  you're connected."
- <a id="SERV-212"></a> **SERV-212** **Refused:** "The feedback service couldn't accept this message." The reason
  follows when the service gives one.
- <a id="SERV-213"></a> **SERV-213** **Anything else:** "Your message couldn't be sent. It's saved here."

<a id="SERV-214"></a>

**SERV-214** **Privacy documentation.** docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D7 and the site's privacy
page (docs/engineering/services-and-feedback.md#SERV-D3) say:
- <a id="SERV-215"></a> **SERV-215** what a message carries;
- <a id="SERV-216"></a> **SERV-216** where it is kept, and for how long;
- <a id="SERV-217"></a> **SERV-217** that only the Proscenium team reads it;
- <a id="SERV-218"></a> **SERV-218** that an email is used only to reply;
- <a id="SERV-219"></a> **SERV-219** that feedback works with reports switched off.

<a id="FEED-D9"></a>

### Tests

- <a id="SERV-220"></a> **SERV-220** **Unit:**
  - <a id="SERV-221"></a> **SERV-221** the character count and the limit;
  - <a id="SERV-222"></a> **SERV-222** when Send is available;
  - <a id="SERV-223"></a> **SERV-223** email checked only when present;
  - <a id="SERV-224"></a> **SERV-224** when the draft is saved, restored and cleared;
  - <a id="SERV-225"></a> **SERV-225** the id reused across retries.
- <a id="SERV-226"></a> **SERV-226** **Rust:**
  - <a id="SERV-227"></a> **SERV-227** the draft file lives in app data and never under the Plays folder;
  - <a id="SERV-228"></a> **SERV-228** the request body holds only what the writer chose. With the box off, there
    is no version in it;
  - <a id="SERV-229"></a> **SERV-229** a lost answer followed by Try Again sends the same id.
- <a id="SERV-230"></a> **SERV-230** **Worker** (service-addresses.md):
  - <a id="SERV-231"></a> **SERV-231** stores each id once;
  - <a id="SERV-232"></a> **SERV-232** refuses an oversized message, a malformed email and an unknown field;
  - <a id="SERV-233"></a> **SERV-233** answers 201 only after storing;
  - <a id="SERV-234"></a> **SERV-234** has no email API, binding or address, so a message goes nowhere but the
    list.
- <a id="SERV-235"></a> **SERV-235** **Smoke,** in both appearances. The native self-test picks these up.
  - <a id="SERV-236"></a> **SERV-236** The acceptance flow (docs/app/preferences-and-help/feedback.md#FEED-D7), opened three ways: from the toolbar, the Help
    menu and Settings. Type "I wish the binder remembered its width", press
    ⌘⏎, hear the announcement, and see the sheet close.
  - <a id="SERV-237"></a> **SERV-237** The dev mock answers with a failure when the fixture asks. The text stays,
    and Try Again and Copy Message appear.
  - <a id="SERV-238"></a> **SERV-238** View Details shows the details text.
  - <a id="SERV-239"></a> **SERV-239** Escape keeps a draft that reopens.
  - <a id="SERV-240"></a> **SERV-240** Keyboard only, axe clean, and at 200% interface text.

<a id="FEED-D10"></a>

### Done when

- <a id="SERV-241"></a> **SERV-241** The acceptance test ([SERV-161](#SERV-161)) passes in smoke and in the installed app.
- <a id="SERV-242"></a> **SERV-242** Report a Problem's GitHub path is gone from the menus, Settings and the
  allowlist.
- <a id="SERV-243"></a> **SERV-243** A real message sent from a release build is stored in the list, and a reply
  to the address the writer gave reaches it.

## Design

`src/feedback/` owns the sheet, draft and receipt state. `src-tauri/src/feedback/` owns native transport and persisted drafts. Only a matching confirmed receipt clears the draft.

Service operation is covered in [Services](../../engineering/services-and-feedback.md).
