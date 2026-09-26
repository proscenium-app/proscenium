// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Plays screen's page counts, filled in behind the rows (docs/app/keeping-work/storage-and-file-format.md#STOR-121).
 *
 * A play at a time, most recently written first — the order the screen lists
 * them in — with the frame given back between plays, so the screen stays in
 * the writer's hands while a folder of scripts is read. A count from the cache
 * (play-pages.ts) costs one small read; a play is paginated only when its
 * script or its format changed.
 *
 * Off (Settings › General), nothing is counted at all. The user formats are
 * read again for each pass, and a format saved in the designer starts one.
 */
import { useEffect, useState } from "react";
import { loadFormatRegistry, subscribeFormats } from "../format";
import { announce } from "../ui";
import { playPages, type PlayPages, type VaultPlay } from "../workspace";

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Each play's pages by its folder, as they come in; a play not in the map yet is still being counted. */
export function usePlayPages(
  plays: readonly VaultPlay[],
  enabled: boolean,
): ReadonlyMap<string, PlayPages> {
  const [pages, setPages] = useState<ReadonlyMap<string, PlayPages>>(() => new Map());
  const [formats, setFormats] = useState(0);
  useEffect(() => subscribeFormats(() => setFormats((n) => n + 1)), []);

  useEffect(() => {
    if (!enabled || plays.length === 0) return;
    let live = true;
    void (async () => {
      const registry = await loadFormatRegistry();
      let counted = 0;
      for (const play of plays) {
        if (!live) return;
        const result = await playPages(play, registry);
        if (!live) return;
        if (result.counted) counted++;
        setPages((prev) => {
          const was = prev.get(play.dir);
          if (was && JSON.stringify(was) === JSON.stringify(result.pages)) return prev;
          const next = new Map(prev);
          next.set(play.dir, result.pages);
          return next;
        });
        await breathe();
      }
      // The cells changed with no focus on them. Said once a pass, and only for
      // a pass that paginated something: a count read back is no news.
      if (live && counted > 0) {
        announce(
          counted === 1 ? "Pages counted for 1 play." : `Pages counted for ${counted} plays.`,
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [plays, enabled, formats]);

  return pages;
}
