#!/usr/bin/env bash
# Copy the live customization (this machine) into the repo. Review `git diff`, then commit.
set -euo pipefail
source "$(dirname "$0")/paths.sh"
mkdir -p "$REPO/herdr-app/mods" "$REPO/herdr-app/layouts" "$REPO/herdr-core/templates" "$REPO/bin"
for m in $MODS; do
  rm -rf "$REPO/herdr-app/mods/$m"
  mkdir -p "$REPO/herdr-app/mods/$m"
  # Herdr writes gpui-kit.d.ts / jsconfig.json into mod folders; they are not ours.
  (cd "$APP/mods/$m" && find . -type f ! -name '*.d.ts' ! -name 'jsconfig.json' ! -path '*/__pycache__/*' -exec cp --parents {} "$REPO/herdr-app/mods/$m/" \;)
done
# The projects root is this machine's folder; the repo ships the portable default.
for l in $LAYOUTS; do sed 's/"root": "[^"]*"/"root": "~\/Projects"/' "$APP/layouts/$l" > "$REPO/herdr-app/layouts/$l"; done
cp "$CORE_TPL"/*.md "$REPO/herdr-core/templates/"
cp "$BIN/hw" "$REPO/bin/hw"
echo "exported to $REPO; now: git -C \"$REPO\" diff --stat"
