#!/usr/bin/env bash
# Copy the live customization (this machine) into the repo. Review `git diff`, then commit.
set -euo pipefail
source "$(dirname "$0")/paths.sh"
mkdir -p "$REPO/mods" "$REPO/layouts" "$REPO/templates"
for m in $MODS; do
  rm -rf "$REPO/mods/$m"
  mkdir -p "$REPO/mods/$m"
  # Herdr writes gpui-kit.d.ts / jsconfig.json into mod folders; they are not ours.
  (cd "$APP/mods/$m" && find . -type f ! -name '*.d.ts' ! -name 'jsconfig.json' ! -path '*/__pycache__/*' -exec cp --parents {} "$REPO/mods/$m/" \;)
done
# The projects root is this machine's folder; the repo ships the portable default.
for l in $LAYOUTS; do sed 's/"root": "[^"]*"/"root": "~\/Projects"/' "$APP/layouts/$l" > "$REPO/layouts/$l"; done
cp "$CORE_TPL"/*.md "$REPO/templates/"
cp "$BIN/hw" "$REPO/hw"
cp "$BIN/nagne-session-hook" "$REPO/nagne-session-hook"
cp "$BIN/herdr-link" "$REPO/herdr-link"
echo "exported to $REPO; now: git -C \"$REPO\" diff --stat"
