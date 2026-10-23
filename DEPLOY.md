# Deploying SiteSight on an Oracle Cloud Always Free VM

(For a quick demo from a laptop instead, see "Demo from a laptop" at the end.)

Everything runs in Docker: `db` (Postgres), `api` (Node), `web` (Caddy: the app, `/api` forwarding, and https).
Data lives in Docker volumes and survives rebuilds: `sitesight-pgdata` (database), `sitesight-data` (photos, documents), `caddy-data` (https certificates).
**Never run `docker compose down -v`**: `-v` deletes those volumes.

## 1. Create the VM

1. Oracle Cloud console → Compute → Instances → **Create instance**.
2. Image: **Canonical Ubuntu 24.04**. Shape: **VM.Standard.A1.Flex** (Ampere, ARM), 2 OCPU and 12 GB memory (Always Free allows up to 4 OCPU / 24 GB in total).
   The AMD "VM.Standard.E2.1.Micro" (1 GB memory) is also free, but too small to build the app.
   "Out of capacity": try another availability domain, or again later.
3. Add your SSH public key, create, and note the **public IP**.
4. Open the ports: the instance's subnet → Security list → **Add ingress rules**: source `0.0.0.0/0`, TCP, destination ports `80` and `443` (port 22 is already open). Optionally also UDP `443` (HTTP/3).

## 2. Prepare the VM

```bash
ssh ubuntu@<public-ip>

# Oracle's Ubuntu images also block ports inside the VM: open 80 and 443 there too
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
exit   # log in again so the docker group applies
```

## 3. Copy the code (from your laptop, in the folder that holds `sitesight/`)

```bash
rsync -av --exclude node_modules --exclude .env --exclude data --exclude web/dist --exclude graphify-out \
  sitesight/ ubuntu@<public-ip>:~/sitesight/
```

`.env` is not copied on purpose: the VM gets its own, with its own database password.

## 4. Settings on the VM

```bash
ssh ubuntu@<public-ip>
cd ~/sitesight
cp .env.example .env && chmod 600 .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
nano .env
```

Set these (the later line wins if a name appears twice):

| Setting | Value |
|---|---|
| `GEMINI_API_KEY` | your key (free tier: Google may use what is sent; use demo data only) |
| `SITE_ADDRESS` | your domain, or without one: `sitesight.<ip with dashes>.sslip.io`, e.g. `sitesight.140-238-1-2.sslip.io` |
| `SIGNUP_CODE` | a code you give to companies; without it anyone who finds the site can sign up |
| `TZ` | `Asia/Kolkata` (already there) |

With your own domain: add a DNS **A record** pointing to the VM's public IP before starting.

## 5. Start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose logs -f web    # wait for "certificate obtained successfully", then Ctrl+C
docker compose exec -it api npm run create-admin
```

The first build takes several minutes. Then open `https://<SITE_ADDRESS>`, and `https://<SITE_ADDRESS>/suhayb` for the admin page.
After a VM restart everything starts again by itself.

## 6. Backups

```bash
crontab -e
# add this line: every night at 02:30, keeps 14 days
30 2 * * * /home/ubuntu/sitesight/scripts/backup.sh >> /home/ubuntu/sitesight-backups/backup.log 2>&1
```

The backups sit on the same VM, so also copy them off now and then (from your laptop):
`rsync -av ubuntu@<public-ip>:~/sitesight-backups/ ./sitesight-backups/`

Restore (replaces what is there now):

```bash
docker compose exec -T db pg_restore -U sitesight -d sitesight --clean --if-exists < ~/sitesight-backups/db-<date>.dump
docker compose exec -T api tar -xzf - -C /data < ~/sitesight-backups/files-<date>.tar.gz
```

## 7. Updating

Copy the code again (step 3), then on the VM:

```bash
cd ~/sitesight && scripts/backup.sh && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The database and photos stay. New tables are created at start; the app never deletes any.

## Useful

| What | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f api` (or `web`, `db`) |
| Stop / start | `docker compose stop` / `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` |
| New admin password | `docker compose exec -it api npm run create-admin` (same email) |
| Disk use | `df -h` and `docker system df` |

## Good to know

- **Idle reclaim**: Oracle can reclaim Always Free instances that stay almost idle for 7 days. Upgrading the account to Pay As You Go stops that and is still free within the Always Free limits (a card is charged only above them).
- **Only ports 80 and 443 are public.** Postgres listens on the VM itself only (`127.0.0.1:5432`), the API only inside Docker.
- **Certificates**: Let's Encrypt limits how many certificates one name can get per week. Keep the `caddy-data` volume (never `down -v`) so rebuilds reuse the certificate. If the sslip.io name hits a limit, use a free DuckDNS name or your own domain.

## Demo from a laptop (Cloudflare quick tunnel)

```bash
scripts/demo.sh        # builds, starts, prints the public https link (and /suhayb for admin)
docker compose exec -it api npm run create-admin   # first time only
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml down   # stop (never add -v)
```

- Free, no Cloudflare account, no router ports opened: the `tunnel` container dials out to Cloudflare.
- The link is random and **changes every time the tunnel restarts**; run `scripts/demo.sh` again to see the new one.
- Works only while the laptop is on, awake and online (set Windows to never sleep while plugged in).
- Cloudflare limits: 100 MB per upload (send fewer photos per update), 100 s per request (fine with Gemini).
- Port 8080 is local only while the tunnel runs; the database never leaves the laptop.
