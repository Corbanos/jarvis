#!/bin/bash
# Publishes `jarvis.local` on the LAN via mDNS.
#
# macOS Bonjour already answers for <LocalHostName>.local (haydens-Mac-mini.local).
# This adds a stable, product-specific name alongside it — without renaming the
# machine — by registering an mDNS proxy record pointing at the current LAN address.
#
# Re-registers whenever that address changes (DHCP renewal, Wi-Fi <-> Ethernet),
# so the name keeps working across network moves.

set -u

ALIAS_HOST="jarvis.local"
CHILD=""

# Prefer the interface holding the default route; fall back to the usual suspects
# so this still resolves on a machine with an unusual interface layout.
lan_ip() {
	local iface ip
	for iface in $(route -n get default 2>/dev/null | awk '/interface:/{print $2}') en0 en1 en2; do
		ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
		if [ -n "$ip" ]; then
			echo "$ip"
			return 0
		fi
	done
	return 1
}

cleanup() {
	[ -n "$CHILD" ] && kill "$CHILD" 2>/dev/null
	exit 0
}
trap cleanup TERM INT

published=""
while true; do
	if ip=$(lan_ip) && [ "$ip" != "$published" ]; then
		[ -n "$CHILD" ] && kill "$CHILD" 2>/dev/null
		echo "$(date '+%Y-%m-%d %H:%M:%S') publishing $ALIAS_HOST -> $ip"
		dns-sd -P jarvis _http._tcp local 80 "$ALIAS_HOST" "$ip" &
		CHILD=$!
		published="$ip"
	fi
	sleep 30
done
