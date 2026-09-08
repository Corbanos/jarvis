#!/bin/bash
# Swaps a staged HUD build (.next-staging) into place (.next).
#
# Two renames, so the live directory is never half-written. Run this right
# before restarting the HUD: the running `next start` holds the *old* build's
# manifests in memory, so once .next changes it must be restarted immediately —
# which is why `self restart` and install.sh call this themselves rather than
# leaving a gap.
set -euo pipefail
HUD="$(cd "$(dirname "${BASH_SOURCE[0]}")/../hud" && pwd)"
cd "$HUD"
if [ ! -f .next-staging/BUILD_ID ]; then
	echo "· no staged build (.next-staging/BUILD_ID missing) — nothing to promote"
	exit 0
fi
rm -rf .next-prev
[ -d .next ] && mv .next .next-prev
mv .next-staging .next
echo "✓ promoted build $(cat .next/BUILD_ID)"
# The previous build is kept until the restart has happened; the caller removes it.
