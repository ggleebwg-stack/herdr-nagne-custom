# Shared paths for export.sh (sourced, not run). The installer is bin/install.js.
APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
if [ -n "${APPDATA:-}" ]; then CORE_TPL="$APPDATA/herdr-core/templates"; else CORE_TPL="$HOME/.config/herdr-core/templates"; fi
BIN="$HOME/.local/bin"
# providers.json lives here: yours. install creates it once from providers.example.json; export never copies it.
NAGNE="$HOME/.config/herdr-nagne"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# What this repo owns. Shipped Herdr layouts/mods are never copied (Herdr rewrites them).
MODS="workers projects status-plus providers resume skills agent-folders scrollback"
LAYOUTS="supervisor.json"
