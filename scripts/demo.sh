#!/usr/bin/env bash
# Starts SiteSight with a public https link (Cloudflare quick tunnel) and prints the link.
# Stop: docker compose -f docker-compose.yml -f docker-compose.tunnel.yml down   (no -v: that deletes the data)
set -euo pipefail
cd "$(dirname "$0")/.."
compose="docker compose -f docker-compose.yml -f docker-compose.tunnel.yml"
$compose up -d --build
echo "Waiting for the Cloudflare link..."
for _ in $(seq 60); do
  url=$($compose logs tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
  if [ -n "$url" ]; then
    echo "Demo link: $url   (admin: $url/suhayb)"
    exit 0
  fi
  sleep 2
done
echo "No link yet: see $compose logs tunnel" >&2
exit 1
