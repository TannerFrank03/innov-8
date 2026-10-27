# Roadmap: Orchestr8, the innov-8 planner (self-hosted Monday.com + Kanban replacement)
- Version: 1.0 | Date: 2026-10-27
- Source research: research-innov8-planner.md
- Goal: Move the Owner and Designer off Monday.com and separate Kanban boards onto one self-owned planning app, at R0/month subscription, by 11 Dec 2026.
- Success metrics: (1) all active projects live in the new app; (2) Monday.com subscription cancelled; (3) both users plan the week in it for 2 weeks without falling back; (4) restore from backup tested once.
- Assumptions: start 28 Oct 2026; team = Owner (business, also runs deploys) + Designer; Claude builds the code; hosting on a machine or small VPS you control; brand assets still to be supplied (research R1).

## Phases
### P1. Confirm inputs (28 Oct -> 30 Oct)
- Objective: close the open questions that change the build.
- Exit criteria: brand hex colours, fonts and logo in hand; hosting target chosen; decision on Monday.com CSV import.

### P2. Design (28 Oct -> 4 Nov)
- Objective: agree what each screen does and how it looks.
- Exit criteria: ERD and wireframes signed off by both users; brand theme file populated.

### P3. Build MVP (2 Nov -> 20 Nov)
- Objective: working app with auth, boards, Table/Kanban/Timeline/Calendar views, task detail, comments, activity.
- Exit criteria: all Must features pass the smoke test; app runs from one `npm start` or Docker command.

### P4. Pilot & migrate (23 Nov -> 4 Dec)
- Objective: run real work in parallel with Monday.com and move boards across.
- Exit criteria: all active boards migrated; no blocking bugs open; backup and restore tested.

### P5. Cut over (7 Dec -> 11 Dec)
- Objective: retire Monday.com.
- Exit criteria: Monday.com cancelled after final export archived.

## Tasks
| ID | Phase | Task | Owner | Estimate | Start | End | Depends on | Status |
|----|-------|------|-------|----------|-------|-----|------------|--------|
| T1 | P1 | Supply brand colours, fonts, logo (or allow innov-8.co.za in environment network settings) | Owner | 1d | 2026-10-28 | 2026-10-28 | - | todo |
| T2 | P1 | Choose hosting: own machine/NAS, small VPS, or container host | Owner | 1d | 2026-10-28 | 2026-10-29 | - | todo |
| T3 | P1 | Export current Monday.com boards to CSV/Excel; list active boards | Designer | 2d | 2026-10-28 | 2026-10-30 | - | todo |
| T4 | P2 | High-level ERD (users, boards, statuses, groups, tasks, labels, comments, subtasks, activity) | Claude | 1d | 2026-10-28 | 2026-10-28 | - | done |
| T5 | P2 | Low-fidelity wireframes: login, dashboard, board (4 views), task drawer | Claude | 2d | 2026-10-28 | 2026-10-29 | - | done |
| T6 | P2 | Review ERD + wireframes, mark changes | Owner + Designer | 2d | 2026-10-30 | 2026-11-02 | T4, T5 | todo |
| T7 | P2 | Populate theme tokens from brand (single CSS file) | Designer | 1d | 2026-11-03 | 2026-11-04 | T1, T6 | todo |
| T8 | P3 | Server: Express API, SQLite schema + migrations, seed data | Claude | 3d | 2026-11-02 | 2026-11-04 | T4 | done |
| T9 | P3 | Auth: login, sessions, password hashing, first-run admin setup | Claude | 2d | 2026-11-04 | 2026-11-05 | T8 | done |
| T10 | P3 | Dashboard: board list, create/archive board, "My tasks" | Claude | 2d | 2026-11-05 | 2026-11-06 | T9 | done |
| T11 | P3 | Kanban view: drag-and-drop between statuses, WIP limits, reorder | Claude | 3d | 2026-11-06 | 2026-11-10 | T10 | done |
| T12 | P3 | Table view: grouped rows, inline edit of status/assignee/priority/dates | Claude | 3d | 2026-11-06 | 2026-11-10 | T10 | done |
| T13 | P3 | Timeline view: bars from start->due date by week | Claude | 2d | 2026-11-11 | 2026-11-12 | T12 | done |
| T14 | P3 | Calendar view: month grid by due date | Claude | 2d | 2026-11-11 | 2026-11-12 | T12 | done |
| T15 | P3 | Task drawer: description, subtasks checklist, labels, comments, activity | Claude | 3d | 2026-11-13 | 2026-11-17 | T11, T12 | done |
| T16 | P3 | Board settings: statuses (colour, WIP), groups, labels, team users | Claude | 2d | 2026-11-17 | 2026-11-18 | T15 | done |
| T17 | P3 | Docker + backup script + README run instructions (Docker image written but not yet built: no Docker daemon in the build environment) | Claude | 1d | 2026-11-19 | 2026-11-19 | T8 | done |
| T18 | P3 | Smoke test all Must features; fix defects | Claude | 1d | 2026-11-20 | 2026-11-20 | T13-T17 | done |
| T19 | P4 | Deploy to chosen host; set up HTTPS and daily backup | Owner | 2d | 2026-11-23 | 2026-11-24 | T2, T17, T18 | todo |
| T20 | P4 | CSV import tool for Monday.com exports (Should) | Claude | 2d | 2026-11-23 | 2026-11-24 | T3, T18 | todo |
| T21 | P4 | Migrate active boards; run both tools in parallel | Owner + Designer | 7d | 2026-11-25 | 2026-12-03 | T19, T20 | todo |
| T22 | P4 | Test restore from backup | Owner | 1d | 2026-12-04 | 2026-12-04 | T19 | todo |
| T23 | P5 | Final Monday.com export archived; cancel subscription | Owner | 1d | 2026-12-07 | 2026-12-11 | G3 | todo |

## Milestones & decision gates
| ID | Name | Date | Criteria | Decision if not met |
|----|------|------|----------|---------------------|
| G1 | Inputs confirmed | 2026-10-30 | T1-T3 done | Build continues with neutral theme; brand swapped in later via theme file only |
| G2 | Design sign-off | 2026-11-04 | T6, T7 done | Hold P3 UI polish; core API continues |
| G3 | Pilot go/no-go | 2026-12-04 | All boards migrated, no blocking bugs, restore tested | Extend pilot 1 week; keep Monday.com one more billing cycle |
| M1 | MVP ready | 2026-11-20 | T18 passes | Cut Should features to protect date |

## Critical path
T1 -> T7 -> T19 -> T21 -> G3 -> T23
(Build path T8 -> T9 -> T10 -> T12 -> T15 -> T16 -> T18 runs in parallel and is complete; the remaining bottleneck is brand + hosting decisions from the Owner.)

## Risks
| ID | Risk | Likelihood | Impact | Mitigation task |
|----|------|------------|--------|-----------------|
| R1 | Brand assets unknown, UI does not match website | High | Medium | T1, T7 (theme isolated in one file) |
| R2 | Self-hosted data loss | Low | High | T17, T19, T22 (daily backup + tested restore) |
| R3 | Free hosting terms change | Medium | Medium | T2 (plain Node + SQLite runs anywhere; no vendor lock-in) |
| R4 | Team drifts back to Monday.com | Medium | Medium | T21 parallel run with all active boards |

## Budget
| Item | Phase | Estimate | Source |
|------|-------|----------|--------|
| Monday.com today (3-seat min, Standard-Pro) | - | $36-$57/month | research S1 |
| Software licences | all | R0 | open source stack |
| Hosting | P4 | R0 on own hardware; small VPS optional | research F4 |
| Domain / subdomain | P4 | existing innov-8.co.za DNS | - |

## Development handoff
- Development needed: yes
- Problem the software solves: one place to plan client and studio work for two people, with the Monday.com views they rely on, without subscription fees or board limits.
- Users & roles: Owner (admin: manages users, board settings) and Designer (member: full task editing). Small fixed team, invite-only.
- Core features (MoSCoW):
  - Must: login/sessions; boards; statuses with colours and WIP limits; groups; tasks with assignee, priority, start/due dates, labels, description; Kanban drag-and-drop; Table with inline edit; Timeline; Calendar; task comments; subtasks; activity log; My tasks; search/filter.
  - Should: CSV import from Monday.com; dark mode; board templates; overdue highlighting.
  - Could: task dependencies on timeline; file attachments; email notifications.
  - Won't (v1): real-time multi-cursor collaboration; mobile native apps; client portal.
- Data entities: User, Session, Board, Status, Group, Task, Label, TaskLabel, Subtask, Comment, Activity (see ERD in planning document).
- Integrations: none in v1.
- Non-functional: responsive (works on phone), brand theme in one file, single-process deploy, SQLite file backup, passwords hashed (scrypt), POPIA-friendly (data stays on your server).
- Linked tasks: T8-T18, T20

## Next 7 days
1. T1 Send brand hex codes, fonts and logo, or allow innov-8.co.za in the environment network settings.
2. T2 Decide where the app will run.
3. T3 Designer exports Monday.com boards to CSV.
4. T6 Both review the ERD and wireframes in the planning page.
5. Run the app locally (`npm install && npm run build && npm start`) and try a real week's tasks.
6. T7 Drop brand tokens into `client/src/theme.css`.
