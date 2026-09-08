#!/bin/bash
# Exercises promote-hud.sh against a fake hud/ layout in a scratch dir.
set -euo pipefail
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/deploy" "$T/hud/.next" "$T/hud/.next-staging"
cp "$(dirname "$0")/promote-hud.sh" "$T/deploy/"
echo OLD > "$T/hud/.next/BUILD_ID"; echo old-chunk > "$T/hud/.next/marker"
echo NEW > "$T/hud/.next-staging/BUILD_ID"

out=$(bash "$T/deploy/promote-hud.sh")
[ "$(cat "$T/hud/.next/BUILD_ID")" = NEW ]            || { echo "✗ .next should now be the staged build"; exit 1; }
[ "$(cat "$T/hud/.next-prev/BUILD_ID")" = OLD ]       || { echo "✗ previous build should be kept as .next-prev until the restart"; exit 1; }
[ ! -e "$T/hud/.next-staging" ]                       || { echo "✗ staging dir should be gone after promotion"; exit 1; }
[[ "$out" == *"promoted build NEW"* ]]                || { echo "✗ unexpected output: $out"; exit 1; }

# A second run with nothing staged is a no-op, not an error.
out=$(bash "$T/deploy/promote-hud.sh")
[[ "$out" == *"nothing to promote"* ]]                || { echo "✗ expected no-op message, got: $out"; exit 1; }
[ "$(cat "$T/hud/.next/BUILD_ID")" = NEW ]            || { echo "✗ no-op must not disturb .next"; exit 1; }

# A staging dir without BUILD_ID (half-finished build) is never promoted.
mkdir -p "$T/hud/.next-staging"; echo junk > "$T/hud/.next-staging/partial"
out=$(bash "$T/deploy/promote-hud.sh")
[ "$(cat "$T/hud/.next/BUILD_ID")" = NEW ]            || { echo "✗ an incomplete staging dir must not replace the live build"; exit 1; }
echo "✓ promote-hud.sh: swap, keep-previous, no-op, and incomplete-staging guard all behave"
