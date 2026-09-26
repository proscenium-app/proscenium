// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import { diagnostics, feedback } from "../storage/ipc";
import { Button, Checkbox, Sheet } from "../ui";
import { announce } from "../ui/announce";
import { canSend, characters, emptyDraft, hasDraft, validEmail, type FeedbackDraft } from "./model";

export function FeedbackSheet() {
  const [formats, setFormats] = useState<string[] | null>(null);
  useEffect(() => {
    const open = (event: Event) =>
      setFormats((previous) => previous ?? (event as CustomEvent<string[]>).detail);
    window.addEventListener("proscenium:feedback", open);
    return () => window.removeEventListener("proscenium:feedback", open);
  }, []);
  return formats === null ? null : (
    <FeedbackForm formats={formats} close={() => setFormats(null)} />
  );
}
function FeedbackForm({ formats, close }: { formats: string[]; close: () => void }) {
  const [draft, setDraft] = useState<FeedbackDraft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [detailsFailed, setDetailsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const occupied = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const count = characters(draft.message);
  const ready =
    loaded && !loadFailed && canSend(draft) && (!draft.includeDetails || details !== null) && !busy;
  const fail = (e: unknown) => {
    const text = e instanceof Error ? e.message : String(e);
    setError(text);
    announce(text, { assertive: true });
  };
  useEffect(() => {
    let active = true;
    void feedback.load().then(
      (saved) => {
        if (active) {
          setDraft(saved);
          setLoaded(true);
        }
      },
      (e) => {
        if (active) {
          setLoaded(true);
          setLoadFailed(true);
          fail(e);
        }
      },
    );
    void diagnostics.review(formats).then(
      (text) => {
        if (active) setDetails(text);
      },
      () => {
        if (active) setDetailsFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [formats]);
  // Loading finishes after Sheet has registered its layer above Settings.
  useEffect(() => {
    if (loaded) field.current?.focus();
  }, [loaded]);
  useEffect(() => {
    if (count >= 9000)
      announce(
        `${count.toLocaleString()} of 10,000 characters.${count > 10000 ? " Shorten your message to send." : ""}`,
      );
  }, [count]);
  useEffect(() => {
    if (loaded && detailsFailed) setDraft((current) => ({ ...current, includeDetails: false }));
  }, [loaded, detailsFailed]);
  const edit = (patch: Partial<FeedbackDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };
  const operation = async (work: () => Promise<void>, isSend = false) => {
    if (occupied.current) return;
    occupied.current = true;
    setBusy(true);
    setSending(isSend);
    try {
      await work();
    } catch (e) {
      fail(e);
    } finally {
      occupied.current = false;
      setBusy(false);
      setSending(false);
    }
  };
  const saveAndClose = () => {
    if (!loaded) return;
    if (loadFailed) {
      close();
      return;
    }
    void operation(async () => {
      await feedback.save(draft);
      close();
    });
  };
  const send = () => {
    if (!ready) return;
    void operation(async () => {
      setError(null);
      await feedback.send(draft, draft.includeDetails ? details : null);
      close();
      announce("Feedback sent. Thank you.");
    }, true);
  };
  const discard = () =>
    void operation(async () => {
      await feedback.discard();
      setDraft(emptyDraft());
      setLoadFailed(false);
      setError(null);
      field.current?.focus();
    });
  return (
    <Sheet
      title="Send Feedback"
      labelledBy="feedback-title"
      width={560}
      onClose={saveAndClose}
      onCommandEnter={send}
      footer={
        <div className="feedback__actions">
          {(hasDraft(draft) || loadFailed) && (
            <Button onClick={discard} disabled={busy}>
              Discard Draft
            </Button>
          )}
          <span className="sheet__spacer" />
          <Button onClick={saveAndClose} disabled={busy || !loaded}>
            Close
          </Button>
          <Button treatment="primary" onClick={send} disabled={!ready}>
            {sending ? "Sending…" : "Send Feedback"}
          </Button>
        </div>
      }
    >
      <div className="feedback" aria-busy={busy}>
        <label className="feedback__field" htmlFor="feedback-message">
          Your feedback
          <textarea
            ref={field}
            id="feedback-message"
            rows={7}
            value={draft.message}
            disabled={busy || !loaded || loadFailed}
            placeholder="What would you like us to know?"
            aria-describedby={`feedback-hint${count >= 9000 ? " feedback-count" : ""}${count > 10000 ? " feedback-limit" : ""}`}
            aria-invalid={count > 10000 || undefined}
            onChange={(e) => edit({ message: e.target.value })}
          />
        </label>
        <p className="feedback__hint" id="feedback-hint">
          What would you like us to know?
        </p>
        {count >= 9000 && (
          <p
            className={`feedback__hint${count > 10000 ? " feedback__error" : ""}`}
            id="feedback-count"
          >
            {count.toLocaleString()} / 10,000 characters
          </p>
        )}
        {count > 10000 && (
          <p className="feedback__error" id="feedback-limit">
            Shorten your message to 10,000 characters to send.
          </p>
        )}
        <label className="feedback__field" htmlFor="feedback-email">
          Email (optional)
          <input
            id="feedback-email"
            type="email"
            autoComplete="email"
            value={draft.email}
            disabled={busy || !loaded || loadFailed}
            aria-describedby={`feedback-email-hint${!validEmail(draft.email) ? " feedback-email-error" : ""}`}
            aria-invalid={!validEmail(draft.email) || undefined}
            onChange={(e) => edit({ email: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey) e.preventDefault();
            }}
          />
        </label>
        <p className="feedback__hint" id="feedback-email-hint">
          Leave your email if you'd like a reply.
        </p>
        {!validEmail(draft.email) && (
          <p className="feedback__error" id="feedback-email-error">
            Check your email address.
          </p>
        )}
        <div className="feedback__details-choice">
          <Checkbox
            label="Include technical details"
            describedBy="feedback-details-hint"
            on={draft.includeDetails}
            onChange={(on) => edit({ includeDetails: on })}
            disabled={busy || details === null || loadFailed}
          />
          <span>Include technical details</span>
        </div>
        <p className="feedback__hint" id="feedback-details-hint">
          {detailsFailed
            ? "Technical details couldn't be collected. You can still send your message."
            : "App version, system information, and recent errors."}
        </p>
        {details !== null && (
          <details className="feedback__details">
            <summary>View Details</summary>
            <textarea aria-label="Technical details" readOnly rows={6} value={details} />
          </details>
        )}
        {error && (
          <div className="feedback__failure">
            <p className="feedback__error">{error}</p>
            <div className="feedback__retry">
              <Button onClick={send} disabled={!ready}>
                Try Again
              </Button>
              <Button
                onClick={() =>
                  void feedback.copy(draft.message).then(() => announce("Message copied."), fail)
                }
                disabled={busy}
              >
                Copy Message
              </Button>
            </div>
          </div>
        )}
        <p className="feedback__hint">Your message goes privately to the Proscenium team.</p>
      </div>
    </Sheet>
  );
}
