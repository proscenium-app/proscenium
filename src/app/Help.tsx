// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from "../ui";
import { openFeedback } from "../feedback";
import { SectionBody } from "./settings/parts";

/** Help uses the same feedback sheet as the toolbar and About. */
export function HelpContent({onOpen}: {onOpen: () => void}) {
  return <SectionBody title="Help & Feedback">
    <p className="settings__note">
      Six short tutorials write one practice play. The guide appears where you work and
      tells you as you go. Send Feedback lets you share an idea, ask a question, or tell us
      what could be better.
    </p>
    <div className="settings__actions">
      <Button onClick={onOpen}>Open Help & Tutorials</Button>
      <Button onClick={() => openFeedback()}>Send Feedback…</Button>
    </div>
  </SectionBody>;
}
