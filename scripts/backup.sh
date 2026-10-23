#!/usr/bin/env bash
# Backs up the database and the photo/document files. Run on the machine where docker compose runs.
# usage: scripts/backup.sh [folder]   (default ~/sitesight-backups; backups older than 14 days are deleted)
# daily at 02:30 (crontab -e):  30 2 * * * /home/ubuntu/sitesight/scripts/backup.sh >> /home/ubuntu/sitesight-backups/backup.log 2>&1
# restore: see DEPLOY.md
set -euo pipefail
umask 077 # backups hold every company's data: readable by the owner only
cd "$(dirname "$0")/.."
out=${1:-$HOME/sitesight-backups}
mkdir -p "$out" && chmod 700 "$out"
stamp=$(date +%Y-%m-%d-%H%M)
docker compose exec -T db pg_dump -U sitesight -Fc sitesight > "$out/db-$stamp.dump.part"
docker compose exec -T api tar -czf - -C /data . > "$out/files-$stamp.tar.gz.part"
# only complete backups get their final name, so a failed run never looks like a good backup
mv "$out/db-$stamp.dump.part" "$out/db-$stamp.dump"
mv "$out/files-$stamp.tar.gz.part" "$out/files-$stamp.tar.gz"
find "$out" -maxdepth 1 \( -name 'db-*.dump' -o -name 'files-*.tar.gz' -o -name '*.part' \) -mtime +14 -delete
echo "$(date '+%F %T') backup ok: $out/db-$stamp.dump, $out/files-$stamp.tar.gz"
