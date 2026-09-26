// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Quitting keeps the words (docs/app/keeping-work/storage-and-file-format.md#STOR-D13: "Blur, hide, tab close, and quit
//! flush immediately"; docs/app/keeping-work/storage-and-file-format.md#STOR-104, no silent loss of an unsaved edit).
//!
//! On 2026-09-13 a scratch build showed that quitting kept nothing the disk did
//! not already have. ⌘Q, the Dock's Quit, an AppleScript `quit` and logging out
//! all reach AppKit's `terminate:`, and tao's app delegate answers only
//! `applicationWillTerminate:`, which is too late to ask anything: the process
//! was gone in about 120 ms, and the page was never told. Words typed in a
//! document a moment before went with it, and so did a document's words whose
//! file was locked in Finder, with the toast still saying they were in the
//! window — and a script's last pause of typing, which autosave had not landed
//! and the five-second recovery snapshot had not reached. The window's close
//! button was the same quit by another door: the last window closing ends the
//! app, and by then its webview is gone.
//!
//! **The gate.** A quit asks the page to settle — land what it can, and keep
//! the rest where the next launch finds it (src/app/quit.ts) — and the app
//! exits when the page says so. Rust decides only how long to wait:
//!
//! - A page that does not say it heard may still hold unsaved words. With a
//!   dirty beacon, a native alert holds the quit until the writer chooses
//!   Don't Quit or Quit Anyway. A clean beacon keeps the two-second exit.
//! - A page that heard and has not answered is still putting words somewhere —
//!   a drive that stopped answering can hold a write for a minute. The quit is
//!   called off rather than cut short. The page answers by itself well before
//!   this, with its own sentence (it gives a settle ten seconds), so this only
//!   catches a page that stopped running after it heard.
//!
//! What to keep, and what to say when words can be kept nowhere, are the page's
//! decisions, like every other meaning in this app. [`Gate`] is the whole policy
//! and has no AppKit in it, so it is tested here; `appkit` only connects it.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// The question, to the page: `{ id }`. Answered with `quit_heard`, then
/// `quit_settled`.
pub const EVENT_QUIT_REQUESTED: &str = "app://quit-requested";

/// How long a page with every word on disk has to say it heard.
const HEARD_WITHIN: Duration = Duration::from_secs(2);
/// The same, while the beacon says some words are not on disk yet: a page
/// that is busy (a long paste, a layout of a long script) still gets to them.
const HEARD_WITHIN_AT_RISK: Duration = Duration::from_secs(10);
/// How long a page that heard may take to answer before the quit is called
/// off. The page's own limit (src/app/quit.ts) is a third of this.
const ANSWERED_WITHIN: Duration = Duration::from_secs(30);
/// How often an unanswered question is looked at.
const LOOK_EVERY: Duration = Duration::from_millis(250);

/// Where the gate stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    /// Nobody has asked to quit, or the last quit was called off.
    Idle,
    /// Question `id` went to the page at `asked`, and holds the quit.
    Asking { id: u64, asked: Instant, heard: bool, at_risk: bool },
    /// The page did not acknowledge a dirty buffer. Only the native alert's
    /// answer decides this held quit; a late page message cannot discard it.
    Confirming { id: u64 },
    /// The page said go, or the writer chose to quit anyway: nothing more is
    /// asked, and the next request quits.
    Leaving,
}

/// What a request to quit comes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Request {
    /// Ask the page question `id`, and hold the quit until it is answered.
    Ask(u64),
    /// A question is already out: hold this quit too, and ask nothing new.
    Hold,
    /// Nothing to ask: quit now.
    Quit,
}

/// What the gate decides about a question that is out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Hold the quit and ask the writer with a native alert.
    Confirm,
    /// Quit now.
    Quit,
    /// Call the quit off: the app stays open, and the page says why.
    Stay,
    /// Keep holding.
    Wait,
    /// Not this question, or not a question any more: nothing to do.
    Done,
}

/// The exit gate's whole policy: one question at a time, and how long each
/// part of the answer may take. Time comes in as arguments.
#[derive(Debug)]
pub struct Gate {
    stage: Stage,
    last: u64,
}

impl Gate {
    pub const fn new() -> Self {
        Gate { stage: Stage::Idle, last: 0 }
    }

    /// Someone asked to quit. `at_risk` is the unsaved-work beacon: whether the
    /// page last said some words are not on disk. It sets only the patience —
    /// the page is asked either way, because the beacon is a message behind.
    pub fn request(&mut self, now: Instant, at_risk: bool) -> Request {
        match self.stage {
            Stage::Leaving => Request::Quit,
            Stage::Asking { .. } | Stage::Confirming { .. } => Request::Hold,
            Stage::Idle => {
                self.last += 1;
                self.stage = Stage::Asking { id: self.last, asked: now, heard: false, at_risk };
                Request::Ask(self.last)
            }
        }
    }

    /// The page heard question `id` and is settling.
    pub fn heard(&mut self, id: u64) {
        if let Stage::Asking { id: out, heard, .. } = &mut self.stage {
            if *out == id {
                *heard = true;
            }
        }
    }

    /// The page's answer to question `id`: `go` when every word is on disk or
    /// kept, or the writer said to quit anyway.
    pub fn answered(&mut self, id: u64, go: bool) -> Verdict {
        match self.stage {
            Stage::Asking { id: out, .. } if out == id => {
                self.stage = if go { Stage::Leaving } else { Stage::Idle };
                if go {
                    Verdict::Quit
                } else {
                    Verdict::Stay
                }
            }
            _ => Verdict::Done,
        }
    }

    /// Question `id` has waited until `now`.
    pub fn tick(&mut self, now: Instant, id: u64) -> Verdict {
        let Stage::Asking { id: out, asked, heard, at_risk } = self.stage else {
            return Verdict::Done;
        };
        if out != id {
            return Verdict::Done;
        }
        let waited = now.saturating_duration_since(asked);
        let hearing = if at_risk { HEARD_WITHIN_AT_RISK } else { HEARD_WITHIN };
        if !heard && waited >= hearing {
            if at_risk {
                self.stage = Stage::Confirming { id };
                Verdict::Confirm
            } else {
                self.stage = Stage::Leaving;
                Verdict::Quit
            }
        } else if heard && waited >= ANSWERED_WITHIN {
            // Somebody there, still working: never cut them short.
            self.stage = Stage::Idle;
            Verdict::Stay
        } else {
            Verdict::Wait
        }
    }

    /// The writer chose to quit whatever is still unsaved. True when a question
    /// was out: the quit it holds ends now, rather than a new one starting.
    pub fn leave(&mut self) -> bool {
        let held = matches!(self.stage, Stage::Asking { .. } | Stage::Confirming { .. });
        self.stage = Stage::Leaving;
        held
    }

    /// The native alert's answer, scoped to the quit that opened it.
    pub fn confirmed(&mut self, id: u64, go: bool) -> Verdict {
        if self.stage != (Stage::Confirming { id }) {
            return Verdict::Done;
        }
        self.stage = if go { Stage::Leaving } else { Stage::Idle };
        if go { Verdict::Quit } else { Verdict::Stay }
    }
}

impl Default for Gate {
    fn default() -> Self {
        Self::new()
    }
}

static GATE: Mutex<Gate> = Mutex::new(Gate::new());
static APP: OnceLock<AppHandle> = OnceLock::new();

fn gate() -> std::sync::MutexGuard<'static, Gate> {
    GATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone, Serialize)]
struct QuitRequested {
    id: u64,
}

/// From setup, once the app delegate exists: every quit comes through here.
pub fn setup(app: &AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(target_os = "macos")]
    if !appkit::install() {
        // A newer tao that answers `applicationShouldTerminate:` itself: the
        // quit is not held, as before this gate. The self-test's quit check
        // would say so.
        eprintln!("quit: the app delegate already answers applicationShouldTerminate:");
    }
}

/// A quit was asked for, from anywhere: ask the page, or say to quit now.
fn request(app: &AppHandle) -> Request {
    let at_risk = crate::settings::words_at_risk(app);
    let request = gate().request(Instant::now(), at_risk);
    if let Request::Ask(id) = request {
        let _ = app.emit(EVENT_QUIT_REQUESTED, QuitRequested { id });
        watch(app.clone(), id);
    }
    request
}

/// Look at an unanswered question until something decides it.
fn watch(app: AppHandle, id: u64) {
    std::thread::spawn(move || loop {
        std::thread::sleep(LOOK_EVERY);
        let verdict = gate().tick(Instant::now(), id);
        match verdict {
            Verdict::Confirm => {
                #[cfg(target_os = "macos")]
                appkit::confirm(id);
                #[cfg(not(target_os = "macos"))]
                {
                    gate().confirmed(id, false);
                    finish(&app, false);
                }
                break;
            }
            Verdict::Wait => continue,
            Verdict::Done => break,
            Verdict::Quit | Verdict::Stay => {
                finish(&app, verdict == Verdict::Quit);
                break;
            }
        }
    });
}

/// End a held quit: out, or called off.
#[cfg(target_os = "macos")]
fn finish(_app: &AppHandle, go: bool) {
    appkit::reply(go);
}

#[cfg(not(target_os = "macos"))]
fn finish(app: &AppHandle, go: bool) {
    if go {
        app.exit(0);
    }
}

/// The window's close button, or Close Window: the last window closing is the
/// app quitting, so it is asked the same question. The caller has already
/// kept the window from closing.
pub fn close_requested(app: &AppHandle) {
    // On a Mac this is `terminate:`, the road ⌘Q takes — sent after this event
    // is handled, never from inside it, so the held quit does not wait inside
    // an event handler that everything else waits behind.
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        appkit::terminate();
    }
    #[cfg(not(target_os = "macos"))]
    if request(app) == Request::Quit {
        app.exit(0);
    }
}

/// The page heard question `id`, and is settling.
#[tauri::command]
pub fn quit_heard(id: u64) {
    gate().heard(id);
}

/// The page settled question `id`: `go` when every word is on disk or kept.
#[tauri::command]
pub fn quit_settled(app: AppHandle, id: u64, go: bool) {
    let verdict = gate().answered(id, go);
    if matches!(verdict, Verdict::Quit | Verdict::Stay) {
        finish(&app, go);
    }
}

/// The writer chose Quit Anyway, or words the page was still putting somewhere
/// when it answered have since been kept: quit now, asking nothing.
#[tauri::command]
pub fn quit_now(app: AppHandle) {
    if gate().leave() {
        finish(&app, true);
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        appkit::terminate();
    }
    #[cfg(not(target_os = "macos"))]
    app.exit(0);
}

/// AppKit's side: `applicationShouldTerminate:` on tao's app delegate, and the
/// reply that ends a held quit.
#[cfg(target_os = "macos")]
mod appkit {
    use std::ffi::c_void;

    use block2::RcBlock;
    use objc2::ffi;
    use objc2::runtime::{AnyObject, Bool, Imp, Sel};
    use objc2::{class, msg_send, sel};

    use super::{request, Request, APP};

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: *const c_void;
        fn CFRunLoopGetMain() -> *mut c_void;
        fn CFRunLoopPerformBlock(rl: *mut c_void, mode: *const c_void, block: &block2::Block<dyn Fn()>);
        fn CFRunLoopWakeUp(rl: *mut c_void);
    }

    /// Run `work` on the main thread, from the run loop itself, in every
    /// common mode. Not the main dispatch queue: a held quit waits in a loop
    /// nested inside whatever called `terminate:`, and when that was a
    /// main-queue block — the close button's road, the first time — nothing
    /// else on that serial queue runs until it returns. The reply waited behind
    /// the quit it was meant to end, and the window stayed up for good.
    fn on_main(work: impl Fn() + 'static) {
        let block = RcBlock::new(work);
        unsafe {
            let main = CFRunLoopGetMain();
            CFRunLoopPerformBlock(main, kCFRunLoopCommonModes, &block);
            CFRunLoopWakeUp(main);
        }
    }

    /// `NSApplicationTerminateReply`.
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;

    /// AppKit asks before every `terminate:` — ⌘Q, the Dock, an Apple Event,
    /// logging out. Holding it (`NSTerminateLater`) keeps the process, the
    /// window and the page alive until `replyToApplicationShouldTerminate:`.
    unsafe extern "C-unwind" fn should_terminate(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else { return TERMINATE_NOW };
        match request(app) {
            Request::Quit => TERMINATE_NOW,
            Request::Ask(_) | Request::Hold => TERMINATE_LATER,
        }
    }

    /// Add `applicationShouldTerminate:` to the delegate tao installed. False
    /// when its class answers it already.
    pub fn install() -> bool {
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![app, delegate];
            if delegate.is_null() {
                return false;
            }
            let class = ffi::object_getClass(delegate) as *mut _;
            let imp: Imp = std::mem::transmute::<
                unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
                Imp,
            >(should_terminate);
            // `Q@:@`: an NSUInteger back, from self, _cmd and the sender.
            ffi::class_addMethod(class, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr()).as_bool()
        }
    }

    /// End the quit AppKit is holding: out, or called off.
    pub fn reply(go: bool) {
        on_main(move || unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![app, replyToApplicationShouldTerminate: Bool::new(go)];
        });
    }

    /// A quit the page never answers asks here instead of exiting: AppKit remains responsive even when WKWebView cannot
    /// answer. The first button is Return's default; only the second discards.
    pub fn confirm(id: u64) {
        on_main(move || {
            use objc2::MainThreadMarker;
            use objc2_app_kit::{NSAlert, NSAlertSecondButtonReturn};
            use objc2_foundation::ns_string;
            if super::gate().stage != (super::Stage::Confirming { id }) {
                return;
            }
            let Some(mtm) = MainThreadMarker::new() else { return };
            let alert = NSAlert::new(mtm);
            alert.setMessageText(ns_string!("Proscenium couldn't confirm your latest words were saved."));
            alert.addButtonWithTitle(ns_string!("Don't Quit"));
            alert.addButtonWithTitle(ns_string!("Quit Anyway"));
            let go = alert.runModal() == NSAlertSecondButtonReturn;
            let verdict = super::gate().confirmed(id, go);
            if matches!(verdict, super::Verdict::Quit | super::Verdict::Stay) {
                reply(go);
            }
        });
    }

    /// Quit the way ⌘Q does, after whatever is running on the main thread now.
    pub fn terminate() {
        on_main(|| unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![app, terminate: std::ptr::null::<AnyObject>()];
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn a_quit_asks_the_page_and_quits_when_it_says_go() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(id) = gate.request(t, false) else { panic!("the page was not asked") };
        gate.heard(id);
        assert_eq!(gate.tick(at(t, 5_000), id), Verdict::Wait, "a page that heard is waited for");
        assert_eq!(gate.answered(id, true), Verdict::Quit);
        // Once it has said go, nothing is asked again: the quit goes.
        assert_eq!(gate.request(at(t, 5_001), true), Request::Quit);
    }

    #[test]
    fn words_that_could_be_kept_nowhere_call_the_quit_off() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(id) = gate.request(t, true) else { panic!() };
        gate.heard(id);
        assert_eq!(gate.answered(id, false), Verdict::Stay);
        // The app goes on, and the next quit asks again, with a new question.
        let Request::Ask(next) = gate.request(at(t, 60_000), true) else { panic!("the next quit asked nothing") };
        assert_ne!(next, id);
    }

    #[test]
    fn a_second_quit_while_one_is_held_asks_nothing_new() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(id) = gate.request(t, false) else { panic!() };
        assert_eq!(gate.request(at(t, 100), false), Request::Hold);
        assert_eq!(gate.answered(id, true), Verdict::Quit);
    }

    #[test]
    fn a_page_that_never_hears_is_not_waited_for() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(id) = gate.request(t, false) else { panic!() };
        assert_eq!(gate.tick(at(t, 1_900), id), Verdict::Wait);
        assert_eq!(gate.tick(at(t, 2_000), id), Verdict::Quit, "nothing on screen to settle");
        // The answer of a page that woke up too late changes nothing.
        assert_eq!(gate.answered(id, false), Verdict::Done);
    }

    #[test]
    fn unsaved_words_get_a_busy_page_longer_to_hear() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(id) = gate.request(t, true) else { panic!() };
        assert_eq!(gate.tick(at(t, 2_000), id), Verdict::Wait, "the beacon says words are at risk");
        assert_eq!(gate.tick(at(t, 9_999), id), Verdict::Wait);
        assert_eq!(gate.tick(at(t, 10_000), id), Verdict::Confirm);
        assert_eq!(gate.request(at(t, 11_000), true), Request::Hold);
        assert_eq!(gate.tick(at(t, 60_000), id), Verdict::Done, "the alert is opened only once");
        gate.heard(id);
        assert_eq!(gate.answered(id, true), Verdict::Done, "a late page response cannot answer the native alert");
        assert_eq!(gate.confirmed(id + 1, true), Verdict::Done);
        assert_eq!(gate.confirmed(id, false), Verdict::Stay);
        assert!(matches!(gate.request(at(t, 61_000), true), Request::Ask(next) if next != id));
    }

    #[test]
    fn a2_14_only_quit_anyway_releases_an_unacknowledged_dirty_buffer() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(id) = gate.request(t, true) else { panic!() };
        assert_eq!(gate.tick(at(t, 10_000), id), Verdict::Confirm);
        assert_eq!(gate.confirmed(id, true), Verdict::Quit);
        assert_eq!(gate.request(at(t, 11_000), true), Request::Quit);
        assert_eq!(gate.confirmed(id, false), Verdict::Done);
    }

    #[test]
    fn a_page_that_heard_is_never_cut_short() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(id) = gate.request(t, false) else { panic!() };
        gate.heard(id);
        assert_eq!(gate.tick(at(t, 29_999), id), Verdict::Wait);
        // Still writing after half a minute: the quit is called off, not the words.
        assert_eq!(gate.tick(at(t, 30_000), id), Verdict::Stay);
        assert_eq!(gate.tick(at(t, 30_250), id), Verdict::Done, "a decided question is not decided twice");
    }

    #[test]
    fn answers_and_ticks_for_another_question_change_nothing() {
        let t = Instant::now();
        let mut gate = Gate::new();
        let Request::Ask(first) = gate.request(t, false) else { panic!() };
        assert_eq!(gate.answered(first, false), Verdict::Stay);
        let Request::Ask(second) = gate.request(at(t, 1_000), false) else { panic!() };
        // The first question's watcher, and a late answer to it.
        assert_eq!(gate.tick(at(t, 5_000), first), Verdict::Done);
        assert_eq!(gate.answered(first, true), Verdict::Done);
        gate.heard(first);
        assert_eq!(gate.tick(at(t, 3_000), second), Verdict::Quit, "hearing the first question is not hearing the second");
    }

    #[test]
    fn quit_anyway_ends_a_held_quit_or_starts_one_that_asks_nothing() {
        let t = Instant::now();
        let mut held = Gate::new();
        let Request::Ask(id) = held.request(t, true) else { panic!() };
        assert!(held.leave(), "the held quit is the one that ends");
        assert_eq!(held.tick(at(t, 20_000), id), Verdict::Done);

        let mut called_off = Gate::new();
        let Request::Ask(id) = called_off.request(t, true) else { panic!() };
        assert_eq!(called_off.answered(id, false), Verdict::Stay);
        assert!(!called_off.leave(), "nothing held: a new quit starts");
        assert_eq!(called_off.request(at(t, 1), true), Request::Quit, "and asks nothing");
    }
}
