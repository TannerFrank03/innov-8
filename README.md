# Innov-8 Planner

Your own planning app for the Innov-8 studio. It replaces Monday.com and separate Kanban boards, with no subscription.

- **Boards** for each client or stream of work, with statuses, groups and labels
- **Four views of the same tasks:** Table, Kanban (drag-and-drop with WIP limits), Timeline and Calendar
- **Task detail:** owner, priority, dates, labels, description, subtasks, comments and activity history
- **Home:** your week at a glance, with overdue and upcoming work across all boards
- Search, filters, light/dark mode, and it works on a phone

## Run it

You need **Node.js 22.13 or newer** ([nodejs.org](https://nodejs.org)).

```bash
npm install
npm run build
npm start             # http://localhost:3000
```

The first visit asks you to create the owner account. Then add your designer under **Settings & team**.

To try it with example data first: `npm run seed` (before first sign-in), then sign in as `owner@example.com` / `changeme123`.

### With Docker

```bash
docker compose up -d --build    # http://localhost:3000, data kept in the "planner-data" volume
```

## Back up

All data is one file: `data/planner.db`.

```bash
npm run backup        # writes backups/planner-<timestamp>.db, keeps the newest 30
```

Schedule it daily: on Linux/macOS, `crontab -e` and add
`0 18 * * * cd /path/to/innov-8 && npm run backup`. On Windows use Task Scheduler.

To restore, stop the app, copy a backup over `data/planner.db`, and start it again.

## Put it online for both of you

Any machine that runs Node or Docker works: an office PC, a NAS, or a small VPS.

1. Run the app (Docker is easiest).
2. Put HTTPS in front of it, for example [Caddy](https://caddyserver.com): `planner.innov-8.co.za { reverse_proxy localhost:3000 }`.
   Or use a free Cloudflare Tunnel if you don't want to open ports.
3. Set `TRUST_PROXY=1` (already set in `docker-compose.yml`) so sign-in cookies are marked Secure.
4. Point a subdomain such as `planner.innov-8.co.za` at it.

## Match the website's brand

All colours and fonts live in **`client/src/theme.css`**. The current values are placeholders, because innov-8.co.za could not be reached when this was built.
Replace `--brand`, `--ink` and the font variables with the website's, update the Google Fonts link in `client/index.html`, then `npm run build`.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `DATA_DIR` | `./data` | Where `planner.db` lives |
| `BACKUP_DIR` / `BACKUP_KEEP` | `./backups` / 30 | Backup location and how many to keep |
| `TRUST_PROXY` | unset | Set to `1` behind an HTTPS reverse proxy |

## Develop

```bash
npm run dev           # API on :3000 and Vite on :5173 with hot reload
npm test              # API and business-rule tests (Vitest)
npm run build && npm run test:e2e   # browser test of the main flow (Playwright)
```

Docs: [research](docs/research-innov8-planner.md) · [roadmap](docs/roadmap-innov8-planner.md) · [spec & API](docs/spec.md) · [architecture](docs/architecture.md) · [planning page with ERD and wireframes](docs/planning.html)
