#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
# No physical layout constants outside the format system (docs/app/formatting/formats-and-layout.md#SCHEMA-D100).
# The renderer, page-view chrome, and PDF path must take every inch/point
# value from the active FormatSpec — in CSS that means var(--fmt-*), in TS a
# spec field. This greps the enforced surfaces for literal in/pt lengths.
set -euo pipefail
cd "$(dirname "$0")/.."

# Enforced surfaces: editor CSS/TSX, page-view chrome, layout engine, PDF path,
# and the .docx/.odt writers (docs/app/formatting/formats-and-layout.md#FMT-147).
files=$(find src/editor src/layout src/pdf src/wordproc -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) ! -name '*.test.ts' 2>/dev/null)

pattern='(^|[^a-zA-Z0-9_.-])[0-9]+(\.[0-9]+)?(in|pt)([^a-zA-Z0-9_]|$)'
bad=$(grep -nE "$pattern" $files || true)

if [ -n "$bad" ]; then
  echo "Physical layout constants found — move them into the format spec:" >&2
  echo "$bad" >&2
  exit 1
fi
echo "layout-constants check: clean ($(echo "$files" | wc -l | tr -d ' ') files)"

# Front sheets must remain consumers of the engine, not independent wrappers
# or paginators. A long cast list once drew below the PDF page, and that overflow escaped the physical-unit-literal check.
for surface in src/editor/pagination.ts src/pdf/render.ts src/pdf/plan.ts src/wordproc/model.ts; do
  if ! rg -q 'paginateFrontMatter\(' "$surface"; then
    echo "Front matter must use the shared paginator: $surface" >&2
    exit 1
  fi
done
if rg -n 'function (wrapPlain|drawTitlePage|drawCastPage|drawSettingPage|titleSheetWidget|frontSheetsWidget)\b' src/editor src/pdf; then
  echo "Front-matter layout belongs in src/layout/engine.ts." >&2
  exit 1
fi
echo "front-matter dependency check: clean"
