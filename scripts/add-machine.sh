#!/usr/bin/env bash
# Add another computer (home, office) that this one reaches over Tailscale, so herdr can run
# and show agents there. Safe to rerun: it only adds what is missing.
#   1. checks for an ssh key (~/.ssh/id_ed25519, else ~/.ssh/id_rsa)
#   2. adds a Host block to ~/.ssh/config (the old file is copied to ~/.ssh/config.bak-<time> first)
#   3. tests the login; if it fails, prints what to do on the other computer and stops
#   4. registers it with herdr-core: hc machine add <name>
# usage: scripts/add-machine.sh <name> <tailscale-name-or-100.x-ip> <user> [--dry-run]
set -euo pipefail
[ $# -ge 3 ] || { echo "usage: scripts/add-machine.sh <name> <tailscale-host> <user> [--dry-run]" >&2; exit 2; }
NAME="$1" HOST="$2" USER_AT="$3" DRY=0
[ "${4:-}" = "--dry-run" ] && DRY=1
[[ $NAME =~ ^[A-Za-z0-9._-]+$ ]] || { echo "name: letters, digits, . _ - only" >&2; exit 2; }
HC=$(command -v hc || command -v hc.exe || echo "$(cygpath -u "${LOCALAPPDATA:-}" 2>/dev/null)/Programs/herdr-core/hc.exe")
CFG="$HOME/.ssh/config"

# 1. key
KEY=""
for k in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do [ -f "$k" ] && { KEY="$k"; break; }; done
if [ -z "$KEY" ]; then
  echo "No ssh key. Make one, then rerun:  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519" >&2; exit 3
fi
echo "key: $KEY"

# 2. ~/.ssh/config block
if grep -q -E "^Host[[:space:]]+$NAME([[:space:]]|$)" "$CFG" 2>/dev/null; then
  echo "ssh config: Host $NAME already there (left as is)"
else
  block=$(printf '\n# added by herdr-nagne-custom add-machine.sh\nHost %s\n  HostName %s\n  User %s\n  IdentityFile %s\n  ServerAliveInterval 30\n' "$NAME" "$HOST" "$USER_AT" "~${KEY#"$HOME"}")
  if [ $DRY = 1 ]; then echo "would append to $CFG:$block"; else
    mkdir -p "$HOME/.ssh"
    [ -f "$CFG" ] && cp "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
    printf '%s\n' "$block" >> "$CFG"
    echo "ssh config: added Host $NAME"
  fi
fi
[ $DRY = 1 ] && { echo "would test: ssh $NAME true; then: hc machine add $NAME"; exit 0; }

# 3. login test (no password prompts)
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAME" true 2>/dev/null; then
  cat >&2 <<EOF

Could not log in to $NAME ($USER_AT@$HOST) with the key. On that computer:
  - Tailscale is running and signed in to the same tailnet (check: tailscale ping $HOST)
  - macOS: System Settings > General > Sharing > Remote Login: on (allow your user only)
    Linux: an ssh server is running (sudo systemctl enable --now ssh)
  - this computer's public key is in ~/.ssh/authorized_keys there. Run this on $NAME:
      mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$(cat "$KEY.pub")' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
Then rerun this script.
EOF
  exit 4
fi
echo "ssh: login ok"

# 4. herdr-core (it offers to install hc there if missing)
"$HC" machine add "$NAME"
echo "Done. In herdr: new space on $NAME, or from a terminal: hc run --on $NAME -- claude"
