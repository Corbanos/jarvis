#!/bin/bash
# Applies Caddyfile changes to the running front door.
#
# The admin API is deliberately off, so there's no `caddy reload` — the daemon
# is restarted instead. Needs root because it owns port 80.
#   sudo bash deploy/reload.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" != "0" ]; then
	echo "✗ Run with sudo: sudo bash $0" >&2
	exit 1
fi

# Fail before bouncing the service if the config is bad.
/opt/homebrew/bin/caddy validate --config "$REPO/deploy/Caddyfile" >/dev/null 2>&1 || {
	echo "✗ Caddyfile is invalid — not restarting. Run 'caddy validate --config $REPO/deploy/Caddyfile' to see why." >&2
	exit 1
}

launchctl kickstart -k system/com.jarvis.caddy
echo "✓ front door restarted"
