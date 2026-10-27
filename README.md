# Orchestr8

Orchestr8 is the innov-8 studio's own planning app. It replaces Monday.com and separate Kanban boards, with no subscription.

- **Boards** for each client or stream of work, with statuses, groups and labels
- **Four views of the same tasks:** Table, Kanban (drag-and-drop with WIP limits), Timeline and Calendar
- **Task detail:** owner, priority, dates, labels, description, subtasks, comments and activity history
- **Home:** your week at a glance, with overdue and upcoming work across all boards
- **Import from Monday.com:** bring a board across from its Excel export, with a preview first
- **Sharing:** invite someone to one project by email or link, as *Can edit* or *Can view & comment*; every project has an ID like `PRJ-0001`
- **Website project template:** a 6–8 week Discovery → Launch plan in one step
- Search, filters, light/dark mode, and it works on a phone

## Run it

You need **Node.js 20 or newer** ([nodejs.org](https://nodejs.org)). Run locally, the data lives in `data/planner.db`.

```bash
npm install
npm run build
npm start             # http://localhost:3000
```

The first visit asks you to create the owner account. Then add your designer under **Settings & team**.

To try it with example data first: `npm run seed` (before first sign-in), then sign in as `owner@example.com` / `changeme123`.

## Deploy to Vercel (with a free Turso database)

Vercel can't keep files between requests, so online the data lives in [Turso](https://turso.tech) (hosted SQLite, free tier: 5 GB, 500M row reads a month).

1. **Create the database.** Sign up at [app.turso.tech](https://app.turso.tech), create a database (pick a region near you, e.g. Europe), open it and copy:
   - the **Database URL** (starts with `libsql://`)
   - a new **Token** (Generate Token → read & write)
2. **Add them to Vercel.** Project → Settings → Environment Variables, for Production (and Preview if you like):
   - `TURSO_DATABASE_URL` = the `libsql://…` URL
   - `TURSO_AUTH_TOKEN` = the token
3. **Redeploy** (Deployments → ⋯ → Redeploy). The tables are created automatically on the first request.
4. Open the site. The first visit asks you to create the owner account; then add your designer under **Settings & team**.

`vercel.json` already tells Vercel how to build: the React app is served from `dist/`, and `/api/*` runs `api/index.js` as a serverless function.
If the variables are missing, the API answers with a message saying exactly that.

> Vercel's free Hobby plan is for personal, non-commercial use. For business use Vercel expects the Pro plan.

## Move boards from Monday.com

1. In Monday.com, open the board → **⋯ → More actions → Export board to Excel**. Tick **Include updates** and **Include subitems**.
2. In Orchestr8: **+ New board → Start from: Import from Monday.com**, and choose the file (.xlsx, or .csv).
3. Check the preview (groups, items, subitems, updates, column matching, and who each Monday.com person becomes), then **Import**.

Statuses keep their Monday.com names and become the Kanban columns; Done, Complete and similar count as finished.
Columns Orchestr8 has no field for are added to each task's description. The file is read in your browser; only the resulting board is sent to the server.

## Share a project

Open the board → **Share**.
- **Invite by email:** people who already have an account get access straight away. Anyone else gets an invite link to send them; it adds them when they sign up with that email.
- **Invite link:** anyone with the link joins after signing in or creating an account. Switch it off when you're done.
- **Access:** *Can edit* (tasks and board columns) or *Can view & comment*. Change or remove access from the same window.

Anyone can create an account from the sign-in page. New accounts are **guests**: they only see projects shared with them.
The studio team (accounts added under Settings & team) sees every project. The owner can make a guest a team member in Settings & team.

## Back up

```bash
npm run backup        # writes backups/planner-<timestamp>.json, keeps the newest 30
```

To back up the **live Vercel data**, run it on your computer with the Turso values set:
`TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run backup`. Turso also keeps 1 day of point-in-time restore on the free plan.

To restore into an empty database: `npm run restore -- backups/planner-<timestamp>.json` (add the Turso variables to restore online).

To schedule a local backup daily on Linux/macOS, `crontab -e` and add
`0 18 * * * cd /path/to/innov-8 && npm run backup`. On Windows use Task Scheduler.

## Or host it yourself

Any machine that runs Node or Docker works: an office PC, a NAS, or a small VPS. Without the Turso variables it uses the local file.

1. Run the app (`docker compose up -d --build` is easiest).
2. Put HTTPS in front of it, for example [Caddy](https://caddyserver.com): `planner.innov-8.co.za { reverse_proxy localhost:3000 }`, or use a free Cloudflare Tunnel.
3. Set `TRUST_PROXY=1` (already set in `docker-compose.yml`) so sign-in cookies are marked Secure.

## Brand

The look matches innov-8.co.za: plum purple (`#3d0f5c`), near-black `#111`, neutral greys, Inter at heavy weights, and pill-shaped buttons.
All colours and fonts live in **`client/src/theme.css`**; the Innov8 logo is `client/public/innov8-logo.png`.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | unset | Use a Turso database instead of the local file (required on Vercel) |
| `DATA_DIR` | `./data` | Where `planner.db` lives when Turso isn't set |
| `BACKUP_DIR` / `BACKUP_KEEP` | `./backups` / 30 | Backup location and how many to keep |
| `TRUST_PROXY` | unset | Set to `1` behind an HTTPS reverse proxy |

## Develop

```bash
npm run dev           # API on :3000 and Vite on :5173 with hot reload
npm test              # API and business-rule tests (Vitest)
npm run build && npm run test:e2e   # browser test of the main flow (Playwright)
```

Docs: [research](docs/research-innov8-planner.md) · [roadmap](docs/roadmap-innov8-planner.md) · [spec & API](docs/spec.md) · [architecture](docs/architecture.md) · [planning page with ERD and wireframes](docs/planning.html)
