#!/bin/bash
# Installs the user-level half of JARVIS hosting: the backend, the HUD, and the
# mDNS alias, all supervised by launchd so they come up at login and restart on
# crash. Run as yourself, NOT with sudo — these agents need your login session
# (computer-use and the voice modules talk to the GUI) and your ~/.jarvis data.
#
# The port-80 front door is root-owned and installed separately: install-root.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/jarvis"

if [ "$(id -u)" = "0" ]; then
	echo "✗ Run this as your own user, not with sudo." >&2
	exit 1
fi

mkdir -p "$AGENTS" "$LOGS"

echo "→ Building production bundles…"
( cd "$REPO" && npm run build )
bash "$REPO/deploy/promote-hud.sh"

for label in com.jarvis.server com.jarvis.hud com.jarvis.mdns; do
	cp "$REPO/deploy/$label.plist" "$AGENTS/$label.plist"
	launchctl bootout "gui/$UID/$label" 2>/dev/null || true
	launchctl bootstrap "gui/$UID" "$AGENTS/$label.plist"
	echo "✓ $label"
done

echo
echo "Logs: $LOGS"
echo "Next: sudo bash $REPO/deploy/install-root.sh   (installs the port-80 front door)"
