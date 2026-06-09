#!/bin/sh
set -e

# Bind Node explicitly to all interfaces so nginx can reach it on 127.0.0.1
HOSTNAME=0.0.0.0 node server.js &

# Wait until Next.js is accepting connections (max ~30 s)
# wget exits non-zero when the connection is refused; 0 once it succeeds.
i=0
until wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "ERROR: Next.js did not start within 30 seconds" >&2
    exit 1
  fi
  sleep 1
done

echo "Next.js ready — starting nginx"

# nginx becomes PID 1 so docker stop sends SIGTERM to it cleanly
exec nginx -g "daemon off;"
