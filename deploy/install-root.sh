#!/bin/bash
# Installs the root-owned half: the Caddy front door on port 80.
# Binding a port below 1024 requires root on macOS, so this piece can't live
# in a LaunchAgent. Run with: sudo bash deploy/install-root.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.jarvis.caddy"

if [ "$(id -u)" != "0" ]; then
	echo "✗ Run with sudo: sudo bash $0" >&2
	exit 1
fi

# macOS already resolves *.localhost to loopback, but pinning it makes the name
# work in clients that do their own resolution and don't special-case it.
if ! grep -q "jarvis.localhost" /etc/hosts; then
	printf '\n# JARVIS local front door\n127.0.0.1\tjarvis.localhost\n::1\t\tjarvis.localhost\n' >> /etc/hosts
	echo "✓ /etc/hosts entry for jarvis.localhost"
else
	echo "· /etc/hosts already has jarvis.localhost"
fi

mkdir -p /opt/homebrew/var/log

install -o root -g wheel -m 644 "$REPO/deploy/$LABEL.plist" "/Library/LaunchDaemons/$LABEL.plist"
launchctl bootout "system/$LABEL" 2>/dev/null || true
launchctl bootstrap system "/Library/LaunchDaemons/$LABEL.plist"
echo "✓ $LABEL listening on :80"
