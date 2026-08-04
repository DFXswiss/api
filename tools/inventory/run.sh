#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$HERE")")"
API_SRC="$ROOT/src"
DIST="$ROOT/dist"
INVENTORY_WORK="$(mktemp -d)"

echo "$INVENTORY_WORK"

if [ ! -d "$DIST" ]; then
  echo "dist/ not found - run \`npm run build\` first" >&2
  exit 1
fi

export API_SRC
export INVENTORY_WORK

python3 "$HERE/sites.py"
DIST="$DIST" node "$HERE/measure.js" "$INVENTORY_WORK/sites.json" "$INVENTORY_WORK/sites-measured.json" "$INVENTORY_WORK/meta-tables.json"
python3 "$HERE/make_table.py"
python3 "$HERE/fix_handlers.py"
python3 "$HERE/add_version_deprecated.py"
python3 "$HERE/endpoint_eff.py"
python3 "$HERE/build_docs.py"

cp "$INVENTORY_WORK/endpoints.md" "$ROOT/docs/endpoints.md"
cp "$INVENTORY_WORK/load-sites.md" "$ROOT/docs/load-sites.md"

echo "Wrote $ROOT/docs/endpoints.md"
echo "Wrote $ROOT/docs/load-sites.md"
echo "These are freshly generated inventories and do not carry the hand-adjusted passages of the published docs - see tools/inventory/README.md before treating them as a replacement."
