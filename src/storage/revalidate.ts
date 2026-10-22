// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Revalidate displayed files without interpreting their contents or dirty state.
 *
 * A file the app is writing is left alone: its write answers with the hash it
 * left, and a change from somewhere else meanwhile meets that write's guarded
 * check, so nothing is missed. Read while the write is out, the file can hold
 * the app's own new bytes before the app knows it wrote them, and they would
 * be taken for somebody else's (own-writes.ts). `writing` says, of a path,
 * how many writes have been sent and whether one is out; a read during which
 * either moved is dropped too.
 */
export async function revalidateFiles(
  paths: string[],
  read: (path: string) => Promise<{ hash: string }>,
  emit: (event: { relPath: string; hash: string | null; revalidated: true }) => void,
  current: () => boolean,
  writing: (path: string) => { sent: number; out: boolean } = () => ({ sent: 0, out: false }),
): Promise<void> {
  for (const path of new Set(paths)) {
    if (!current()) return;
    const before = writing(path);
    if (before.out) continue;
    const settled = () => {
      const now = writing(path);
      return !now.out && now.sent === before.sent;
    };
    try {
      const fresh = await read(path);
      if (!current()) return;
      if (!settled()) continue;
      emit({ relPath: path, hash: fresh.hash, revalidated: true });
    } catch (error) {
      if (!current()) return;
      if (!settled()) continue;
      // Remote-only bytes and a failed read are unavailable, not deletions.
      if (/ENOENT|no such file|os error 2\)/i.test(String(error)))
        emit({ relPath: path, hash: null, revalidated: true });
    }
  }
}
