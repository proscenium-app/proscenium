// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words a general English dictionary does not carry but a playwright types
 * every day. Merged into every speller (dictionary.ts) alongside the cast.
 *
 * The bar for a line here is "the base dictionary rejects it AND a writer would
 * reasonably type it into a script" — each entry was checked against
 * dictionaries/en.dic rather than guessed, so nothing on this list is dead
 * weight. Anything the dictionary already knows (apron, scrim, batten, tableau,
 * understudy, blackout, matinee, twas, til, 'em) is deliberately absent.
 *
 * `theatre` leads the list for a reason: the American dictionary spells it
 * "theater", and a play that says "theatre" is not making a mistake.
 */
export const STAGE_WORDS: readonly string[] = [
  // The building and its parts
  "theatre",
  "theatres",
  "cyclorama",
  "cycloramas",
  "cyc",
  "blackbox",
  "callboard",
  "sightline",
  "sightlines",
  "houselight",

  // The room's craft
  "crossfade",
  "crossfades",
  "followspot",
  "followspots",
  "gobo",
  "gobos",
  "downlight",
  "uplight",
  "cueing",
  "loadout",
  "preshow",
  "postshow",
  "tablework",
  "sitzprobe",
  "restage",
  "restaged",
  "upstager",
  "unamplified",
  "voiceover",
  "adlib",
  "adlibs",
  "workshopped",
  "workshopping",

  // Talking about the play
  "playwriting",
  "dramaturg",
  "dramaturgs",
  "dramaturge",
  "dramaturgy",
  "dramaturgical",
  "wrylies",
  "throughline",
  "throughlines",
  "superobjective",
  "dramatis",
  "bookwriter",
  "bookwriters",
  "commedia",
  "sotto",
  "voce",
  "matinée",

  // The traditions a note or a stage direction names
  "Stanislavski",
  "Meisner",
  "Brechtian",
  "Shakespearian",

  // Dialogue as people actually say it. The dropped-g class ("talkin'",
  // "nothin'") needs no entries — speller.ts restores the letter — so these are
  // only the elisions and noises that rule cannot reach.
  "tis",
  "ol",
  "yall",
  "yer",
  "naw",
  "dontcha",
  "mmm",
  "mmhmm",
];
