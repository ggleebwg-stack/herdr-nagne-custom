#!/usr/bin/env bash
# Install the kit on this machine: mods, the supervisor layout, worker templates and hw.
# Anything it replaces is moved first to ~/.herdr-config-backup/<time>/ (nothing is deleted).
# keys.json, settings.json and providers.json are yours: the kit never overwrites them.
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
for m in $MODS; do put "$REPO/mods/$m" "$APP/mods/$m"; done
for l in $LAYOUTS; do put "$REPO/layouts/$l" "$APP/layouts/$l"; done
for t in "$REPO"/templates/*.md; do put "$t" "$CORE_TPL/$(basename "$t")"; done
put "$REPO/hw" "$BIN/hw"; run chmod +x "$BIN/hw"
if [ -f "$NAGNE/providers.json" ]; then echo "kept your $NAGNE/providers.json"
else run mkdir -p "$NAGNE"; run cp "$REPO/providers.example.json" "$NAGNE/providers.json"; fi
cat <<EOF
Installed. Replaced files are in $BK (if any).
Next:
  1. Add the bindings in keys.snippet.json to $APP/keys.json
  2. Set your projects folder: "root" in $APP/layouts/supervisor.json (default ~/Projects)
  3. Switch layout: Ctrl+Shift+L, or  herdr-app do layout.switch '{"name":"supervisor"}'
  4. Choose providers (Claude, Codex, Grok, OpenRouter) in $NAGNE/providers.json
  5. Other computers over Tailscale: scripts/add-machine.sh <name> <tailscale-host> <user>
EOF
