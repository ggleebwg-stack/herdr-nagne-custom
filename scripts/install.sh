#!/usr/bin/env bash
# Install the kit on this machine: mods, the supervisor layout, worker templates and hw.
# Anything it replaces is moved first to ~/.herdr-config-backup/<time>/ (nothing is deleted).
# keys.json and settings.json are yours: the kit never overwrites them (see README for the lines to add).
# usage: scripts/install.sh [--dry-run]
set -euo pipefail
source "$(dirname "$0")/paths.sh"
DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; *) echo "unknown option $a" >&2; exit 2;; esac; done
BK="$HOME/.herdr-config-backup/$(date +%Y%m%d-%H%M%S)"
run() { if [ $DRY = 1 ]; then echo "would: $*"; else "$@"; fi; }
# Move an existing target aside, then copy the repo's version in.
put() { local src="$1" dst="$2"
  if [ -e "$dst" ]; then run mkdir -p "$BK/$(dirname "${dst#$HOME/}")"; run mv "$dst" "$BK/${dst#$HOME/}"; fi
  run mkdir -p "$(dirname "$dst")"; run cp -r "$src" "$dst"; }
# mod.json before main.js: a mod folder that appears without mod.json gets docked into the
# shown layout by Herdr. Copying the whole folder at once keeps them together.
for m in $MODS; do put "$REPO/herdr-app/mods/$m" "$APP/mods/$m"; done
for l in $LAYOUTS; do put "$REPO/herdr-app/layouts/$l" "$APP/layouts/$l"; done
for t in "$REPO"/herdr-core/templates/*.md; do put "$t" "$CORE_TPL/$(basename "$t")"; done
put "$REPO/bin/hw" "$BIN/hw"; run chmod +x "$BIN/hw"
cat <<EOF
Installed. Replaced files are in $BK (if any).
Next:
  1. Add the bindings in herdr-app/keys.snippet.json to $APP/keys.json
  2. Set your projects folder: "root" in $APP/layouts/supervisor.json (default ~/Projects)
  3. Switch layout: Ctrl+Shift+L, or  herdr-app do layout.switch '{"name":"supervisor"}'
EOF
