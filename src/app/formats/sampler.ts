// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The format sampler: the short play the designer lays out when it is not
 * previewing the writer's own (docs/app/formatting/formats-and-layout.md#SET-D104).
 *
 * It exists to be moved by a format, so it holds one of everything a format
 * decides: a title page for {title}, {author} and {draftDate}, two acts and
 * their scenes for {act}, {scene} and act-scene-page numbers, a scene
 * heading, stage directions, cues with and without an
 * extension, a parenthetical, a transition, a lyric, centred text, a
 * dual-dialogue pair — and a speech longer than any page, so a split, its
 * (CONT'D) and the page-break minimums always have something to act on.
 * sampler.test.ts holds it to all of that under every built-in format.
 */
import { parse } from "../../fountain";
import type { Doc, FrontMatter } from "../../fountain/model";
import type { LayoutMeta } from "../../layout";

/** The stage manager's calls: sixty-odd short lines, one speech, always a split. */
const CALLS = [
  "Standby lights forty-two.",
  "Standby sound G.",
  "Standby fly nine, the drop.",
  "Lights forty-two, go.",
  "Sound G, go.",
  "Fly nine, go.",
  "Thank you. Hold, please.",
  "Somebody find the ghost light.",
  "No, not that one. The real one.",
  "Standby lights forty-three.",
  "Standby the revolve.",
  "Crew, clear the revolve, please.",
  "Clear? Thank you.",
  "Lights forty-three, go.",
  "Revolve, go.",
  "Watch the doorway. Watch it.",
  "Good. Standby lights forty-four.",
  "Standby the rain.",
  "Rain is a go when he says the word umbrella.",
  "He did not say umbrella.",
  "He said parasol.",
  "We will talk about parasol at notes.",
  "Rain, go.",
  "Rain, stop. That was the hose.",
  "Thank you, Dev.",
  "Standby lights forty-five through fifty.",
  "Those are a sequence. Take them on my count.",
  "Forty-five, go.",
  "Forty-six, go.",
  "Forty-seven, go.",
  "Forty-eight is the special. Hold it.",
  "Hold it.",
  "Forty-eight, go.",
  "Forty-nine, go.",
  "Fifty, go.",
  "Beautiful. Nobody touch anything.",
  "Standby sound H, the storm.",
  "Standby wind machine.",
  "Sound H, go.",
  "Wind machine, go.",
  "Less wind. Less. That is a hurricane.",
  "That is a breeze. Split the difference.",
  "Thank you.",
  "Standby the trap.",
  "Is the trap clear? I need a clear.",
  "I have a clear. Trap, go.",
  "Standby blackout.",
  "Standby house lights.",
  "Standby the bows, all of it.",
  "Blackout, go.",
  "Hold.",
  "Hold.",
  "Bows lights, go.",
  "Curtain, go.",
  "House lights, go.",
  "That's the show.",
  "Notes in ten minutes.",
  "Somebody get me a coffee.",
  "And somebody find me that parasol.",
  "Thank you, everyone.",
  "Good night.",
];

/** The sampler as Fountain — kept readable, since the writer reads it in the preview. */
export const FORMAT_SAMPLER = `Title: The Prompt Book
Credit: a sampler by
Author: Proscenium
Draft date: For trying formats
Contact:
    Settings › Formats

# ACT ONE

## SCENE 1

= Every element a format decides, once.

.A REHEARSAL ROOM. LATE.

A long table covered in scripts. A single work light. NELL, the stage manager, sits with the prompt book open. ARLO paces with a coffee he has forgotten to drink.

ARLO
It's the second act. It has always been the second act.

NELL
(not looking up)
It's the first act. You just don't notice it until the second.

ARLO (O.S.)
I'm going to get more coffee.

NELL
You have coffee.

ARLO
I have cold coffee.

NELL ^
Cold coffee is still coffee.

~Oh, the ghost light burns for nobody,
~it burns so the stage can see.

> LIGHTS SHIFT.

## SCENE 2

The same room. The table is cleared. NELL stands, headset on, calling the whole show from memory.

NELL
${CALLS.join("\n")}

> BLACKOUT.

# ACT TWO

## SCENE 1

.THE STAGE. OPENING NIGHT.

ARLO alone in the wings, holding a parasol.

ARLO
(to the parasol)
Don't let me down.

> END OF PLAY <
`;

let parsed: { doc: Doc; frontMatter: FrontMatter } | null = null;

/** The sampler, parsed once: its document and its title page. */
export function formatSampler(): { doc: Doc; frontMatter: FrontMatter; meta: LayoutMeta } {
  parsed ??= parse(FORMAT_SAMPLER);
  const { doc, frontMatter } = parsed;
  return {
    doc,
    frontMatter,
    meta: { title: frontMatter.title, author: frontMatter.authors?.join(", "), frontMatter },
  };
}
