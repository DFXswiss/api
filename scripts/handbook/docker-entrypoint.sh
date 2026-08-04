#!/bin/sh
# Create Basic-Auth credentials from env at container start.
# Credentials must never be baked into the image (public repo).
set -eu

if [ -z "${HANDBOOK_USER:-}" ] || [ -z "${HANDBOOK_PASSWORD:-}" ]; then
  echo "handbook: HANDBOOK_USER and HANDBOOK_PASSWORD must both be set and non-empty." >&2
  echo "handbook: refusing to start without authentication (fail loud)." >&2
  exit 1
fi

htpasswd -bBc /etc/nginx/handbook.htpasswd "$HANDBOOK_USER" "$HANDBOOK_PASSWORD"

# Hand PID 1 to nginx so signals (SIGTERM etc.) are delivered correctly.
exec nginx -g 'daemon off;'
