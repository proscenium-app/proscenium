// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Revalidate displayed files without interpreting their contents or dirty state. */
export async function revalidateFiles(
  paths: string[],
  read: (path: string) => Promise<{ hash: string }>,
  emit: (event: { relPath: string; hash: string | null }) => void,
  current: () => boolean,
): Promise<void> {
  for (const path of new Set(paths)) {
    if (!current()) return;
    try {
      const fresh = await read(path);
      if (!current()) return;
      emit({ relPath: path, hash: fresh.hash });
    } catch (error) {
      if (!current()) return;
      // Remote-only bytes and a failed read are unavailable, not deletions.
      if (/ENOENT|no such file|os error 2\)/i.test(String(error)))
        emit({ relPath: path, hash: null });
    }
  }
}
