// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { wordAround } from "./hold-to-select";

describe("the word under a held finger", () => {
  const text = "Held words, the pipe’s too.";
  const word = (offset: number) => {
    const at = wordAround(text, offset);
    return at ? text.slice(at.start, at.end) : null;
  };

  test("is the word the point is in", () => {
    expect(word(0)).toBe("Held");
    expect(word(2)).toBe("Held");
    expect(word(7)).toBe("words");
    expect(word(17)).toBe("pipe’s");
  });

  test("at a word's edge is that word, the one ending there first", () => {
    expect(word(4)).toBe("Held");
    expect(word(5)).toBe("words");
    expect(word(10)).toBe("words");
  });

  test("where there are no words is none", () => {
    expect(wordAround("  —  ", 2)).toBeNull();
    expect(wordAround("", 0)).toBeNull();
  });
});
