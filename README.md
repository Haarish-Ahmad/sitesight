# SiteSight

Construction progress tracking from site photos, for Indian residential builders (houses and apartment blocks).

The site manager says **which room** and **which stage** a photo shows. The AI never decides the stage: it only checks the photos, answers questions and estimates the finish date. Progress is replayed from those claims, and a stage counts as finished only once someone approves it.

## Features

- **Projects** – a wizard builds every room from floors, or from blocks → floors → flats. Flat types, stilt parking, basements and shared spaces are supported. A plan drawing can be uploaded and read into floors, flats and blocks.
- **Updates** – photos and short videos (up to 2 min, 100 MB, 3 per update) with a room and stage. An offline outbox saves updates on the phone and sends them when signal returns.
- **Automatic photo checks** (background queue) – exact duplicate, EXIF age, GPS distance from the site, an AI stage check, and a before/after comparison of the same room.
- **Review and issues** – approve or reject stage claims, track issues (the AI can suggest some).
- **Overview** – progress map per floor/flat, to-do list, latest updates, required checklist items per room, and a finish estimate.
- **Finish estimate** – built from the building's size, a crew size usual for the site, and the real pace, then checked by the AI. With under 7 days of updates it says "Need more" instead of guessing.
- **Ask AI** – per-project chat with exact figures and citations; can also answer questions about a photo; mic input.
- **Reports** – daily, weekly and monthly, with PDF print. Read-only share links need no login.
- **Documents**, **room QR stickers** (deep-link to Upload), before/now photo slider.
- **WhatsApp Cloud API** – report templates, alerts and typed questions (off until a token is configured).
- **Accounts** – one account per company; an admin page at `/suhayb` shows companies and usage, never content.
- **Field-ready UI** – 48 px targets, high contrast, works one-handed on a phone in sunlight.

## Tech stack

| Part | Choice |
| --- | --- |
| Language | TypeScript (strict), ESM |
| Server | Node (`src/server.ts`), Postgres via `pg`, `sharp`, `exifr`, `zod`, ffmpeg/ffprobe for video |
| Web | React 19 + Vite, plain CSS (`web/style.css`) |
| AI | Ollama (local, default `qwen2.5vl:3b`) or Google Gemini, chosen with `AI_PROVIDER` |
| Tests | vitest |
| Deploy | Docker Compose: Caddy (web + https) → Node api → Postgres |

## Quick start (Docker)

```bash
cp .env.example .env
# fill in: GEMINI_API_KEY (free key at https://aistudio.google.com/apikey)
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
docker compose up --build -d
```

Open http://localhost:8080 and create a company account. Compose runs with `AI_PROVIDER=gemini`.

> `docker compose down -v` deletes the database and all uploaded files (volumes `sitesight-pgdata` and `sitesight-data`).

Rebuild one part after a change:

```bash
docker compose up -d --build --no-deps web      # add `api` if server code changed
```

Public demo link from a laptop (Cloudflare quick tunnel): `scripts/demo.sh`.

## Run without Docker

You need Node, a Postgres database (`DATABASE_URL`) and, for video, ffmpeg.

```bash
npm install
npm run api          # API on :3001 with local Ollama
npm run api:gemini   # API on :3001 with Gemini
npm run web          # Vite dev server, proxies /api (set API_URL to override)
```

## Configuration (`.env`)

See `.env.example` for the full list. Main values:

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `local` (Ollama) or `gemini` |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Ollama address and vision model |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini key; model is a comma list, the next one is used when a day's free quota runs out |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | Database (set the password once, before first start) |
| `SIGNUP_CODE` | Optional code required to create an account |
| `COOKIE_SECURE` | Only if a proxy other than the included Caddy serves https |
| `SITE_ADDRESS` | Domain for production (Caddy fetches a Let's Encrypt certificate); `:8080` = plain http locally |
| `WHATSAPP_*`, `PUBLIC_URL` | WhatsApp Cloud API; nothing is sent while `WHATSAPP_TOKEN` is empty |

The Gemini free tier lets Google use what is sent (photos, plans, questions). Do not use it for real client data.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run check` | Type-check server and web, then run tests (db tests are skipped) |
| `npm test` / `npm run typecheck` | Tests only / types only |
| `npm run build:web` | Production web build into `web/dist` |
| `npm run create-admin` | Create an admin account (in Docker: `docker compose exec -it api npm run create-admin`) |
| `npm run read-plan <img>` | Read a plan drawing from the command line |
| `npm run compare` | Compare AI models; results go to `eval-results/` |
| `npm run whatsapp-setup` | Create the WhatsApp templates through the API |
| `scripts/eval.ts` | Photo stage-label evaluation |
| `scripts/backup.sh` | `pg_dump` plus a tar of the data folder, keeps 14 days |

Database tests need a separate database:

```bash
DATABASE_URL=postgres://sitesight:<pw>@localhost:5432/sitesight_test npx vitest run
```

## Project layout

```
src/
  structure.ts  stages.ts  summary.ts  finish.ts   domain logic, shared with the web app
  describe.ts  report.ts  alerts.ts  checklist.ts  rules.ts
  check.ts  compare.ts  ai/                        photo checks, AI provider routing (Ollama / Gemini)
  eta.ts  chat.ts  plan.ts  video.ts  whatsapp.ts  AI estimate, chat, plan reading, video, WhatsApp
  accounts.ts  auth.ts  db.ts  projects.ts         accounts, sessions, storage
  server.ts                                        HTTP API
  tests/                                           vitest
web/                                               React app (Dashboard, NewProject, Project + tabs, Admin)
scripts/                                           CLI tools, backup, demo
plans/  eval-data/  eval-results/                  sample plans and evaluation material
Caddyfile  Dockerfile.*  docker-compose*.yml       deployment
DEPLOY.md                                          Oracle VM deployment steps
```

Rules worth knowing: `finish.ts` and the other shared domain files must not import server-only code, because the web app imports them. `eta.ts` imports the AI client, so web must never import it.

## How it works

- **Progress** is replayed from the list of updates (claims). Finishing counts only when approved; rejected claims never count.
- **Photo checks** run one at a time in a background queue, so uploads return immediately.
- **Videos** are converted to 720p H.264; four frames are sent to the AI in one call. A frame is stored as the video's thumbnail, so photos and videos behave the same everywhere.
- **Plan reading**: the vision model only copies labels as text; code builds the floors, flat types and blocks, and the wizard shows the draft for checking. Slow on small local models (minutes per sheet).
- **Storage**: Postgres for data; photo, video and document files under `DATA_DIR`.

## Security

- Passwords hashed with scrypt (random salt); 5 wrong tries lock the account for 15 minutes.
- Sessions: random token in an HttpOnly, SameSite=Strict cookie; only its hash is stored. 7 days (admin: 2 hours).
- Every project route checks ownership; another company's project answers 404.
- Per-IP rate limits and an Origin check on every non-GET request.
- Caddy sets security headers (CSP, no framing, nosniff, HSTS). Share links are read-only.
- The admin page never shows passwords, content, addresses, phones or share links.

## Deployment

Production target is a single VM (Oracle ARM A1) running `docker-compose.prod.yml` on ports 80/443. Full steps, backups and cron line are in [DEPLOY.md](DEPLOY.md).

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Status

Working and used locally. Open items: more labelled photos to measure flag accuracy, choosing the production model (3b / 7b / Gemini / Claude) after a cost check, trying real project plans, WhatsApp test number and templates, and the Oracle VM deploy. Design notes live in `SITESIGHT_PLAN.md` (in the parent folder).
