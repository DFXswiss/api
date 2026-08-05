#!/usr/bin/env bash
set -euo pipefail

# Runs the inventory chain and leaves both documents in the work directory.
#
# By default it does NOT touch docs/. The published documents carry passages added by hand
# after their first generation, and a full run does not reproduce them - overwriting them is a
# deliberate act, so it takes a flag. See scripts/inventory/README.md.

WRITE_DOCS=0
for arg in "$@"; do
  case "$arg" in
    --write-docs) WRITE_DOCS=1 ;;
    -h|--help)
      echo "usage: $0 [--write-docs]"
      echo "  --write-docs  overwrite docs/endpoints.md and docs/load-sites.md with the fresh run,"
      echo "                discarding the hand-adjusted passages they carry"
      exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$HERE")")"
API_SRC="$ROOT/src"
DIST="$ROOT/dist"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found - the inventory scripts need it" >&2
  exit 1
fi

if [ ! -d "$DIST" ]; then
  echo "dist/ not found - run \`npm run build\` first" >&2
  exit 1
fi

INVENTORY_WORK="$(mktemp -d)"
echo "work directory: $INVENTORY_WORK (kept after the run; remove it when you are done)"

export API_SRC
export INVENTORY_WORK

python3 "$HERE/sites.py"
DIST="$DIST" node "$HERE/measure.js" "$INVENTORY_WORK/sites.json" "$INVENTORY_WORK/sites-measured.json" "$INVENTORY_WORK/meta-tables.json"
python3 "$HERE/make_table.py"
python3 "$HERE/add_version_deprecated.py"
python3 "$HERE/endpoint_eff.py"
python3 "$HERE/build_docs.py"

if [ "$WRITE_DOCS" = "1" ]; then
  cp "$INVENTORY_WORK/endpoints.md" "$ROOT/docs/endpoints.md"
  cp "$INVENTORY_WORK/load-sites.md" "$ROOT/docs/load-sites.md"
  echo
  echo "Overwrote $ROOT/docs/endpoints.md"
  echo "Overwrote $ROOT/docs/load-sites.md"
  echo "The hand-adjusted passages of the published documents are gone from these files - check"
  echo "\`git diff docs/\` before keeping the result."
else
  echo
  echo "Generated $INVENTORY_WORK/endpoints.md"
  echo "Generated $INVENTORY_WORK/load-sites.md"
  echo "docs/ was not touched. These are a data source, not a replacement for the published"
  echo "documents - see scripts/inventory/README.md. Compare with:"
  echo "  diff $INVENTORY_WORK/load-sites.md $ROOT/docs/load-sites.md"
fi
