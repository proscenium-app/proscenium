#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Habiby LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The scale gate (docs/engineering/design-system.md#UI-D104 acceptance, UI audit Q5).
#
# check-layout-constants.sh keeps PHYSICAL layout out of the code; this keeps
# CHROME layout on the scale. The audit counted thirty type sizes and nine
# radii across 4,384 lines, of which docs/engineering/design-system.md#UI-D100 documented six and four — not
# because anyone decided thirty, but because nothing ever said no. Without a
# gate they come back inside a quarter.
#
# Hard-failed:
#   font-size   — the six chrome sizes {10,11,12,13,15,17}px
#   border-radius — the radius scale {0,2,3.5,4,5,6,7,8,10}px, pills as 999px
#   gap         — the seven-step space scale {0,1,2,4,6,8,12,16,24}px
#
# A `var(--token)` always passes: the point of the gate is to push one-off
# numbers into the token block, not to ban arithmetic. Script/page geometry is
# exempt everywhere it reads a --fmt-* value, which check:layout already owns.
#
# Padding and margin are deliberately NOT gated. The mockups themselves land on
# 9, 11, 14, 20 and 22px insets, so a seven-step padding rule would be a rule
# the design does not keep — and a gate nobody believes gets disabled.
set -uo pipefail
cd "$(dirname "$0")/.."

FILES="$(rg --files src/app -g '*.css' | LC_ALL=C sort) src/editor/stage-format.css"
FAIL=0

check() {
  local prop="$1" allowed="$2" label="$3"
  # Every `prop: …px` declaration, wherever it sits on the line — a one-line
  # rule (`.x { font-size: 14px }`) is still a declaration, and a gate that
  # only reads the start of a line is a gate you can walk around by accident.
  local hits
  hits=$(grep -nE "(^|[{;[:space:]])${prop}:[^;}]*[0-9]" $FILES \
    | grep -v 'var(--' \
    | grep -vE '^[^:]*:[0-9]+:[[:space:]]*/\*' \
    || true)
  [ -z "$hits" ] && return 0

  local bad=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # Isolate this property's value, wherever on the line it starts.
    local values
    values=$(printf '%s' "$line" \
      | sed -E "s/.*(^|[{;[:space:]])${prop}:[[:space:]]*//; s/[;}].*$//")
    # Anything with no px at all (percentages, keywords, 50%) is not a step.
    printf '%s' "$values" | grep -q 'px' || continue
    local v ok
    for v in $(printf '%s' "$values" | grep -oE '[0-9]+(\.[0-9]+)?px'); do
      ok=0
      for a in $allowed; do [ "$v" = "${a}px" ] && ok=1; done
      [ "$ok" = "0" ] && bad="${bad}${line}\n"
    done
  done <<< "$hits"

  if [ -n "$bad" ]; then
    echo "design-tokens: ${label} off the scale (allowed: ${allowed})"
    printf '%b' "$bad" | sort -u | sed 's/^/  /'
    FAIL=1
  fi
}

check "font-size"     "10 11 12 13 15 17"      "font-size"

# rem and em font sizes are off the scale by construction: the six sizes are
# px, and a relative one is how thirty of them appeared in the first place.
# `em` inside the SCRIPT is the format spec's business (check:layout owns it),
# so only chrome rules are scanned — everything in the chrome stylesheets not
# reading a --fmt-* value.
REM=$(grep -nE 'font-size:[^;}]*(rem|em)[;}]' $FILES | grep -v 'var(--' || true)
if [ -n "$REM" ]; then
  echo "design-tokens: font-size in relative units (the six sizes are px):"
  printf '%s\n' "$REM" | sed 's/^/  /'
  FAIL=1
fi
check "border-radius" "0 2 3.5 4 5 6 7 8 10 999" "border-radius"
check "gap"           "0 1 2 4 6 8 12 16 24"   "gap"

# Undefined tokens silently drop their whole declaration, which is how the
# Changes surface lost Courier Prime and the change buttons lost a background.
# Every --token READ must have a definition somewhere in the sheet.
DEFINED=$(grep -ohE '^[[:space:]]*--[a-z0-9-]+:' $FILES | tr -d ' :' | sort -u)
USED=$(grep -ohE 'var\(--[a-z0-9-]+' $FILES | sed 's/var(//' | sort -u)
MISSING=""
for t in $USED; do
  printf '%s\n' "$DEFINED" | grep -qx -- "$t" || MISSING="$MISSING $t"
done
# --kb-inset, --prev-* and --fmt-* are written by JS or the format spec inline,
# not by this sheet.
MISSING=$(printf '%s' "$MISSING" | tr ' ' '\n' \
  | grep -v '^--fmt-' | grep -v '^--kb-inset$' | grep -v '^--prev-' | grep -v '^$' || true)
if [ -n "$MISSING" ]; then
  echo "design-tokens: read but never defined (the declaration is dropped):"
  printf '%s\n' "$MISSING" | sed 's/^/  /'
  FAIL=1
fi

if [ "$FAIL" = "0" ]; then
  echo "design-tokens check: clean"
fi
exit $FAIL
