#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The license gate. Every source file names its copyright holder and license in
# its first lines, so the tree can go public without a file whose terms are a
# guess. Files that cannot carry a comment are annotated in REUSE.toml instead.
# Untracked files count too: a new file is exactly the one that forgets.
set -euo pipefail
cd "$(dirname "$0")/.."

# The file list is taken first, and checked: a `git` that fails inside a
# process substitution used to leave the loop with nothing to check and the
# gate saying "clean (0 files)".
files=$(git ls-files --cached --others --exclude-standard -- \
  '*.ts' '*.tsx' '*.css' '*.rs' '*.mjs' '*.sh' '*.swift' 'index.html') || {
  echo "spdx check: git ls-files failed, so nothing was checked"
  exit 1
}
if [ -z "$files" ]; then
  echo "spdx check: git ls-files found no source files, which cannot be right"
  exit 1
fi

missing=()
count=0
while IFS= read -r f; do
  case "$f" in src-tauri/gen/*) continue ;; esac
  [ -f "$f" ] || continue
  count=$((count + 1))
  # REUSE-IgnoreStart — the marker below is the thing searched for, not a license
  if ! head -n 5 "$f" | grep -q "SPDX-License-Identifier:"; then
    missing+=("$f")
  fi
  # REUSE-IgnoreEnd
done <<< "$files"

if [ "$count" -lt 50 ]; then
  echo "spdx check: only $count source files were seen — the listing is wrong, not the tree"
  exit 1
fi

if [ "${#missing[@]}" -gt 0 ]; then
  printf '  missing SPDX header: %s\n' "${missing[@]}"
  echo "spdx check: ${#missing[@]} file(s) without a license header — copy the two lines from any neighbour"
  exit 1
fi
echo "spdx check: clean ($count files)"
