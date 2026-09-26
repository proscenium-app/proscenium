// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sample play (docs/app/keeping-work/storage-and-file-format.md#STOR-135).
 *
 * Someone who downloads this has forty seconds, and the editor's whole premise
 * — predictive Enter and one-keystroke correction — is invisible until there is
 * a script in front of it. An empty starter play teaches none of it.
 *
 * Bundled as a string rather than read from `sample-vault/`, which is a repo
 * fixture and is not inside the shipped app. Short on purpose: two scenes, four
 * characters, every element the editor knows, so the leader menu and the
 * element bar have something to point at.
 */
export const SAMPLE_PLAY_TITLE = "The Weight of Water";

export const SAMPLE_PLAY = `Title: The Weight of Water
Credit: a play by
Author: A Sample
Draft date: September 2026

# ACT ONE

## The jetty, before dawn

= She will not sell. He has not yet said what he came to say.

The last working jetty of a harbour town. Black water. A single light on a pole, and the sound of rope against wood.

MARGUERITE stands at the end of it with her coat still on. She has been there some time.

IVO
(from the dark, behind her)
You'll catch something out here.

MARGUERITE
I have caught everything there is.

IVO steps into the light. He is holding a folder he would rather not be holding.

IVO
The council meets Thursday.

MARGUERITE
The council meets every Thursday. It's what a council is.

IVO
Marguerite.

MARGUERITE
Don't.

A long moment. The rope goes on knocking.

> BLACKOUT.

## Kitchen, the same morning

= She asks him for a date. He gives her a metaphor. Neither of them moves.

Weak light. A kettle that has already boiled twice.

MARGUERITE
You keep saying the word later as if it were a room we could walk into.

IVO
(not looking up)
It is a room. You have just never been in it at this hour.

She takes the kettle off the ring. The room gets quieter than it was.

MARGUERITE
Then unlock it.

Nothing. The tide turns somewhere behind the wall.

IVO
I don't have the key. I have a form.

[[Does he ever say the thing he came to say? — a comment, and it never prints]]

# ACT TWO

## The council chamber

= The vote. It goes the way votes go.

A room that was grand in 1911 and has been repainted twice since.

THE CLERK
Those in favour.

Hands. Not enough of them, or too many, depending on where you are sitting.

MARGUERITE
(standing)
May I say something.

THE CLERK
You may not.

~ And the water came up over the stones

> END OF PLAY.
`;
