#!/bin/bash
# Tears down JARVIS hosting. Run plain to remove the user agents; the daemon and
# the hosts entry need sudo, and the script says so when it gets there.

set -uo pipefail

for label in com.jarvis.server com.jarvis.hud com.jarvis.mdns; do
	launchctl bootout "gui/$UID/$label" 2>/dev/null
	rm -f "$HOME/Library/LaunchAgents/$label.plist"
	echo "✓ removed $label"
done

if [ "$(id -u)" = "0" ]; then
	launchctl bootout system/com.jarvis.caddy 2>/dev/null
	rm -f /Library/LaunchDaemons/com.jarvis.caddy.plist
	sed -i '' '/JARVIS local front door/d; /jarvis\.localhost/d' /etc/hosts
	ROOT_CRT="/opt/homebrew/var/lib/caddy/pki/authorities/local/root.crt"
	[ -s "$ROOT_CRT" ] && security remove-trusted-cert -d "$ROOT_CRT" 2>/dev/null
	echo "✓ removed com.jarvis.caddy, the hosts entry, and the local CA trust"
else
	echo "· front door left in place — run 'sudo bash $0' to remove it too"
fi
