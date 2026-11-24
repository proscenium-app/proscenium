// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a field that holds a word as the writer spells it asks of the system's
 * text input (docs/engineering/cross-platform.md#PLAT-71): no capital and no
 * correction. The dictionary's word, a status, a tag, a search or filter, find
 * and replace, and a language code are each the writer's own spelling, and
 * changing it is changing what they asked for.
 *
 * Capitals alone were not enough: iPadOS's autocorrection replaces a word with
 * one it has learned as Return is pressed, so a word added to the dictionary
 * in lower case came back with the capital it had been typed with before.
 *
 * Spread on the field: `<input {...AS_TYPED} … />`. as-typed.test.ts holds
 * every such field to it.
 */
export const AS_TYPED = {
  autoCapitalize: "none",
  autoCorrect: "off",
} as const;
