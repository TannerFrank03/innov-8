# Research Brief: Subscription-free planning app for Innov-8
- Date: 2026-10-27
- Requested by: Tanner Frank (Innov-8)
- Core question: What should a self-owned replacement for Monday.com + Kanban boards look like for a 2-person team (owner + designer), which features matter, what free stack should run it, and how should it match the innov-8.co.za look?
- Market / region: South Africa (team), global SaaS pricing in USD

## Executive summary
- Monday.com's free plan covers up to 2 seats but caps you at 3 boards; paid tiers start at $9/seat/month with a 3-seat minimum, so a 2-person team pays for 3 seats. [Medium: vendor-published blog pages, not the live pricing page]
- The views a small team actually uses on Monday.com are Table, Kanban, Timeline/Gantt and Calendar, all reading the same item data. Gantt/Timeline sit on paid tiers. [Medium]
- Kanban practice centres on status columns, cards and per-column WIP limits that surface bottlenecks. [High: Atlassian primary docs]
- For two users, a single Node.js server with an embedded SQLite file is enough. It runs with no database bills and can be backed up by copying one file. [High: engineering judgement on documented limits]
- Free hosted options have catches: Vercel Hobby is non-commercial only; Supabase Free pauses inactive projects (data kept); Cloudflare D1 free now hard-fails after daily read/write limits. [High: primary docs]
- The innov-8.co.za brand could not be read: the session's network policy blocks the domain, and no archived copy was reachable. Brand colours and fonts are an open question. [High that this is unknown]

## Findings
### F1. Monday.com costs a 2-person team more than it should
- Detail: Free plan covers up to 2 seats and 3 boards. Basic, Standard and Pro are $9, $12 and $19 per seat per month billed annually. Paid plans require at least 3 seats. Timeline and Gantt are on Standard and above; milestones and critical path need Pro.
- Evidence: [S1], [S2], [S3]
- Confidence: Medium - vendor blog and support pages; confirm on the live pricing page.
- Implication for the project: The comparison point is roughly $36-$57/month (3 Standard-Pro seats). A self-hosted app removes this and the 3-board cap.

### F2. Core views to replicate: Table, Kanban, Timeline, Calendar
- Detail: Monday.com boards hold items in groups with typed columns (status, person, date, timeline). Views are saved tabs over the same data. Kanban groups cards by status. Timeline/Gantt show date ranges and dependencies. Calendar plots items by date. Automations are if-then recipes (e.g. notify on status change).
- Evidence: [S3], [S4], [S5]
- Confidence: Medium - vendor-described, consistent across pages.
- Implication: The data model must be view-agnostic: one task record rendered by four views.

### F3. Kanban essentials: columns, cards, WIP limits
- Detail: A WIP limit is the maximum number of items in a column. It flags overload early. Cards carry title, owner, due date and labels.
- Evidence: [S6], [S7]
- Confidence: High - primary docs.
- Implication: Columns need an optional WIP limit with a visible warning; cards need assignee, due date, priority, labels and comments.

### F4. Free hosted backends have usage cliffs
- Detail: Supabase Free gives 500 MB database and 50k MAU per project and pauses projects after a week of low activity; Pro is $25/month. Vercel Hobby is for personal, non-commercial use only. Cloudflare D1 Free allows 5M row reads and 100k writes per day and 5 GB storage, failing queries over the limit from 1 Sep 2026; Pages Free allows 500 builds/month.
- Evidence: [S8], [S9], [S10], [S11], [S12]
- Confidence: High - primary docs.
- Implication: Vercel Hobby is not appropriate for business use. Prefer a single self-contained server (Node + SQLite) that runs on any small VPS, home server or container host. Cloudflare Pages+D1 is a viable free alternative later.

### F5. Brand match is blocked on access
- Detail: innov-8.co.za returned a proxy 403 (environment network policy) and did not resolve for the fetch tool. Web search returned only unrelated "Innov8" businesses.
- Evidence: direct attempts (no citable source)
- Confidence: High that the brand is unverified.
- Implication: Isolate every colour/font in one theme file so the real brand can be dropped in without touching components.

## Market & competitors
| name | offering | price point | positioning | source |
|---|---|---|---|---|
| Monday.com Work Management | Boards, 15+ views, automations | Free (2 seats, 3 boards); $9/$12/$19 seat/mo, 3-seat min | All-in-one work OS | S1, S2 |
| Jira (Kanban) | Kanban board with WIP limits | not researched | Software teams | S6 |

## Costs & suppliers
| item | supplier | indicative cost | MOQ | source |
|---|---|---|---|---|
| Hosted Postgres | Supabase | Free (pauses when idle); Pro $25/mo | - | S8, S9 |
| Frontend hosting | Vercel Hobby | Free, non-commercial only | - | S10 |
| Pages + D1 | Cloudflare | Free within daily limits | - | S11, S12 |
| Self-hosted Node + SQLite | any VPS / own machine | hardware or small VPS only | - | F4 |

## Risks & unknowns
- R1 Brand colours/fonts unknown - resolve by allowing the domain in the environment's network settings or by the user supplying hex codes and font names.
- R2 Self-hosting needs someone to run backups - mitigated by single-file SQLite plus a documented backup command.
- R3 Free tier terms change (Vercel and Cloudflare both reserve the right) - avoid hard dependency on any one free tier.

## Open questions for the user
- Q1 Brand hex colours, fonts and logo (or allow innov-8.co.za in network settings).
- Q2 Where will it run: own computer/NAS, a small VPS, or a free cloud tier?
- Q3 Do you need to import existing Monday.com boards (CSV export)?

## Handoff to Planner
- Goals: replace Monday.com + Kanban for 2 users at zero subscription cost; Table, Kanban, Timeline and Calendar views over shared data; on-brand UI.
- Constraints: budget ~R0/month; 2 users; must be maintainable by a non-specialist; brand assets pending.
- Candidate workstreams: brand/theme, data model + API, auth, board views, comments/activity, deployment + backups, CSV import.
- Software development needed: yes - the deliverable is a web application.

## Sources
| ID | Title | Publisher | Type | Date | URL |
|---|---|---|---|---|---|
| S1 | How much does monday.com cost? | monday.com | Vendor pricing article | 2026 | https://monday.com/blog/product/how-much-does-monday-com-cost/ |
| S2 | Free AI Gantt Chart Software | monday.com | Vendor product page | 2026 | https://monday.com/partners/gantt |
| S3 | Available plan types on Work Management | monday.com support | Vendor docs | 2026 (~259 days) | https://support.monday.com/hc/en-us/articles/115005320209-Available-plan-types-on-Work-Management |
| S4 | The Timeline Column | monday.com support | Vendor docs | n.d. | https://support.monday.com/hc/en-us/articles/115005333969-The-Timeline-Column |
| S5 | monday.com calendar: views, widgets, and planning | monday.com | Vendor article | 2026 | https://monday.com/blog/project-management/monday-calendar/ |
| S6 | Kanban tutorial with Jira | Atlassian | Vendor docs | n.d. | https://www.atlassian.com/agile/tutorials/how-to-do-kanban-with-jira |
| S7 | Kanban cards | Atlassian | Vendor docs | n.d. | https://www.atlassian.com/agile/kanban/cards |
| S8 | Pricing & Fees | Supabase | Official pricing | 2026 | https://supabase.com/pricing |
| S9 | Do Supabase projects pause when they're inactive? | Supabase | Official KB | 2026 | https://supabase.com/kb/faqs/platform/free-project-pausing |
| S10 | Vercel Hobby Plan | Vercel | Official docs | 2026 | https://vercel.com/docs/plans/hobby |
| S11 | D1 enforces free tier daily query limits | Cloudflare | Official changelog | 2026-09-01 | https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ |
| S12 | Limits - Cloudflare Pages | Cloudflare | Official docs | 2026 | https://developers.cloudflare.com/pages/platform/limits/ |
