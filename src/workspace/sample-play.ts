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
 * fixture and is not inside the shipped app.
 *
 * The play is Noël Coward's Hay Fever (first edition, Ernest Benn, 1925),
 * public domain in the United States; the tutorials write its opening lines
 * too (src/tutorial/lessons.ts). Three passages, each in his words and his
 * order: the opening of Act One, the silent tea that ends it, and the start of
 * Act Two's game. Coward's acts have no scenes, so the passages are numbered
 * beats, SCENE 1 and SCENE 2, and never titled: a title he did not write puts
 * words into the play. The summaries and the comment are ours. Layout only besides:
 * straight quotes, bracketed directions as parentheticals, his underlined
 * words in italics, and the two speeches spoken together as dual dialogue.
 * Short on purpose, with most of what the editor knows (acts, scenes,
 * summaries, directions, cues, parentheticals, emphasis, dual dialogue, a
 * comment, a transition, centred text), so the leader menu and the element bar
 * have something to point at.
 */
export const SAMPLE_PLAY_TITLE = "Hay Fever";

export const SAMPLE_PLAY = `Title: Hay Fever
Credit: a light comedy in three acts by
Author: Noël Coward
Source: An excerpt, from the first edition (1925)

# ACT ONE

## SCENE 1

= Sorel and Simon suspect their mother has asked someone down for the weekend.

The hall of DAVID BLISS's house is very comfortable and extremely untidy. There are several of SIMON's cartoons scattered about the walls, masses of highly coloured American and classical music strewn about the piano, and lots of flowers and comfortable furniture.

When the curtain rises it is about three o'clock on a Saturday afternoon in June.

SIMON, in an extremely dirty tennis shirt and baggy grey flannel trousers, is crouched in the middle of the floor, cutting out squares from cartridge paper.

SOREL, more neatly dressed, is stretched on the sofa, reading a very violently bound volume of poems which have been sent to her by an aspiring friend.

SOREL
I wish she hadn't sent me the beastly book. I must say something nice about it.

SIMON
The binding's very dashing.

SOREL
She used to be such fun before she married that gloomy little man.

SIMON
She was always a fierce *poseuse*. It's so silly of people to try and cultivate the artistic temperament. *Au fond* she's just a normal, bouncing Englishwoman.

SOREL
You didn't shave this morning.

SIMON
I know I didn't, but I'm going to in a minute, when I've finished this.

SOREL
I sometimes wish we were more normal and bouncing, Simon.

SIMON
Why?

SOREL
I should like to be a fresh, open-air girl with a passion for games.

SIMON
Thank God you're not.

SOREL
It would be so soothing.

SIMON
Not in this house.

SOREL
Where's Mother?

SIMON
In the garden, practising.

SOREL
Practising?

SIMON
She's learning the names of the flowers by heart.

SOREL
What's she up to?

SIMON
I don't know.—Damn! that's crooked.

SOREL
I always distrust her when she becomes the Squire's lady.

SIMON
So do I.

SOREL
She's been at it hard all day—she tapped the barometer this morning.

SIMON
She's probably got a plan about impressing somebody.

SOREL
(taking a cigarette)
I wonder who.

[[Who else has asked someone down? — a comment, and it never prints]]

## SCENE 2

= Four guests at tea, and nothing anyone can think of to say.

Everybody sits down.

SIMON
(ungraciously)
Here you are.

SANDY
Thanks.

There is a long pause; then MYRA and RICHARD speak together.

RICHARD
How far are you from Maidenhead exactly?

MYRA ^
What a pity it's raining—we might have had some tennis——

They both stop, to let the other go on. There is another terrible silence.

MYRA
I adore the shape of this hall—it's so——

RICHARD ^
The train was awfully crowded coming down——

They both stop again, and there is another dead silence, during which

> THE CURTAIN SLOWLY FALLS.

# ACT TWO

## SCENE 1

= After dinner, the family explains a game, all at once.

It is after dinner on the Saturday evening. Everyone is talking and arguing. The following scene should be played with great speed.

SIMON
Who'll go out?

SOREL
I don't mind.

SIMON
No; you always guess it too quickly.

JACKIE
What do we have to do?

JUDITH
Choose an adverb, and then——

SIMON
Someone goes out, you see, and comes in, and you've chosen a word among yourselves, and she or he or whoever it is asks you some sort of question and you have to——

SOREL
Not an ordinary question, Simon; they have to ask them to do something in the manner of the word, and then——

SIMON
Then, you see, you act whatever it is——

SOREL
The answer to the question, you see?

RICHARD
(apprehensively)
What sort of thing is one expected to do?

JUDITH
Quite usual things, like reciting "If," or playing the piano——

RICHARD
I can't play the piano.

SIMON
Never mind; you can fake it, as long as it conveys an idea of the word.

> END OF THE EXCERPT <
`;
