# AGENTS.md — CockpitSim

Instructions for AI coding agents working in this repo.

## What This Is

Helicopter cockpit simulator training system (Final Year Project). Will eventually integrate MSFS 2020 via SimConnect — **do not build SimConnect/telemetry features unless asked**; current focus is auth + dashboards.

4-person monorepo, default branch `dev`. Ownership: Adam (repo owner) — Trainee Dashboard; Member 2 — Trainer Dashboard; Member 3 — Backend/Auth/DB; Member 4 — WPF Launcher/WebView2/SimConnect.

## Commands

```bash
# Backend API (from backend/CockpitSim/)
dotnet build
dotnet run                      # http://localhost:5247 — profile "http"
                                # Swagger: http://localhost:5247/swagger

# Frontend — no build step, static HTML/CSS/JS. Two ways to serve:
#   1. The backend serves it: http://localhost:5247/dashboard/login/login.html
#   2. VS Code Live Server on dashboard/login/login.html (port 5500)

# Verify JS syntax without serving:
node --check <file.js>
```

No test suite exists yet. Verify backend changes by calling endpoints via Swagger.

## Demo Accounts (seeded in database)

Login is **DB-backed**: `AuthController` verifies credentials via ASP.NET Core Identity (`UserManager<ApplicationUser>`) against SQLite (`ApplicationDbContext`, registered in `Program.cs`). Passwords are PBKDF2-hashed by Identity — never plaintext.

Seeded by `Data/DbInitializer.cs` (Development only, idempotent — safe on every startup):

- `trainer_azlan` / `Azlan123!` → trainer dashboard
- `trainer_hakim` / `Hakim123!` → trainer dashboard
- `trainee_adam` / `Adam123!` → trainee pre-session (assigned: azlan)
- `trainee_faris` / `Faris123!` (assigned: azlan)
- `trainee_syafiq` / `Syafiq123!` (assigned: hakim)
- `trainee_danish` / `Danish123!` (assigned: hakim)

Demo training sessions + notes are also seeded (only when the Sessions table is empty) so dashboards render data on first run.

`Data/app.db` is gitignored — first run regenerates and re-seeds it. To reset demo data: stop the backend, delete `Data/app.db`, restart.

DB provider is environment-driven (set in `Program.cs`): **Development → SQLite** (`Data/app.db`, zero setup), **Production → MySQL via Pomelo** (conn string `MySqlConnection` in `appsettings.Production.json`, schema reference in `database/mysql/cockpitsim_schema.sql`).

Startup behavior differs by provider (in `Program.cs`): **SQLite** auto-applies the checked-in EF migrations via `MigrateAsync()` (self-provisioning dev file). **MySQL does NOT run EF migrations** — the checked-in migrations are SQLite-flavored (`TEXT`/`INTEGER`, `Sqlite:Autoincrement`) and would crash Pomelo at startup. Instead, on MySQL the app only checks `CanConnectAsync()` and logs; the schema must exist already.

Production provisioning (needs a machine with MySQL + `dotnet ef`): either apply `database/mysql/cockpitsim_schema.sql` directly, or generate a parallel MySQL migration set (separate `--output-dir` / `MigrationsAssembly`) and apply that. Do this BEFORE first prod launch. Also create a least-privilege MySQL user (not root) and supply its password via the `ConnectionStrings__MySqlConnection` environment variable — never commit it.

## Auth Flow (decided, do not change casually)

1. Login → `POST /api/auth/login` → returns JWT + profile (userId, username, fullName, role, assignedTrainerId). Other live endpoints: `/api/me`, `/api/sessions`, `/api/trainees`
2. Frontend stores JWT under localStorage key `cockpitSim.jwt`, profile under `cockpitSim.session`
3. Routing by role returned by API: trainee → pre-session, trainer → trainer-dashboard, **admin → role-select** (role-select is admin/dev-preview ONLY — trainees/trainers never see it)
4. Protected pages call `requireRole([...])` from `shared/js/auth.js`. This is a UX gate only — the real guard is `[Authorize]` server-side
5. Logout must call `clearSession()`, not just navigate away
6. All API calls go through `shared/js/api.js`; if the backend port changes, update `API_BASE_URL` there

## Gotchas

- **HTTPS redirect is disabled in Development on purpose** (`Program.cs`) so the plain-HTTP dashboard can call the API. Don't "fix" this.
- **Backend also serves the dashboard** at `/dashboard` via PhysicalFileProvider pointing at `../../dashboard` — path assumes the monorepo layout; moving folders breaks it.
- **No CDN dependencies** (fonts, icons) — WebView2 may run offline. Icons are inline SVG. Fonts: IBM Plex Sans/Mono, JetBrains Mono for HUD.
- **Design tokens in `shared/css/main.css` are locked** (`--bg-base: #0A0E14`, `--accent-cyan: #00D9FF`, etc.) — don't alter without approval.
- **Never rename element IDs** that existing JS references.
- Dummy data stubs must carry a `// TODO:` marking the integration point — no silent placeholders.
- Roles are lowercase everywhere (`trainee`, `trainer`, `admin`) — matching the authorization policies in Program.cs and the seeded Identity roles.
- `Data/app.db` is a local runtime artifact (gitignored). Delete it + restart the backend to reset/re-seed demo users, sessions, and notes.

## Telemetry & Grading Contract (decided — build against this)

The grading/telemetry pipeline (SimConnect → InfluxDB → backend → dashboard) is
**parked** per the top of this file. This section is the **contract** the
dashboards and backend are built to when that work resumes. Dashboards render
this shape from a stub today; the real sources get implemented later. **Do not
change the shape or the scenario keys without a team decision — they become
stored data.**

**Data flow:**

```
MSFS ─SimConnect→ InfluxDB (raw samples @ 10–20Hz hover / 1–2Hz cruise)
                      │
   live:  backend polls Influx (last N sec)  → GET /api/sessions/{id}/live    (score: null)
   end:   backend aggregates window, grades  → stored in dashboard_reports.metrics_json
                                             → GET /api/me/sessions/{id}/report (immutable snapshot)
                      │
              SessionReport (ONE shape) ──► trainer live view + trainee post-session
```

**Decisions (locked):**
- **Dashboards never query InfluxDB directly** — always via the ASP.NET backend
  (owns JWT auth).
- **Score is computed once at session-end and stored** in
  `dashboard_reports.metrics_json` (the column already reserved in
  `database/mysql/cockpitsim_schema.sql`). Post-session reads the snapshot; it is
  NOT recomputed on read. Immutable/auditable report; keeps the trainee view off
  Influx.
- **Live trainer view uses polling, not SignalR/WebSocket.** 1s hover / 2s
  cruise matches the polling rates in `BasicHeliTraining.md`. Push is a known
  ceiling; upgrade path = SignalR **only if** in-session alerts need sub-second
  latency. Marked in code with a `ponytail:` comment.
- **One renderer, one payload, two sources.** Live = latest values,
  `score: null`. Post = aggregates + `score`. Same `SessionReport` shape for
  both.

**`SessionReport` payload (the contract):**

```jsonc
{
  "sessionId": "guid",
  "scenario": "hover",                 // one of the 5 keys below
  "status": "in_progress | completed | cancelled | scheduled",
  "startedAt": "iso8601", "endedAt": "iso8601 | null",
  "score": null,                       // number when graded; null = live / not yet scored
  "metrics": [
    { "key": "radar_alt", "label": "Radar Alt", "unit": "ft",
      "actual": 5.1, "target": 5.0, "tolerance": 2.0, "withinTol": true }
  ],
  "warnings":  [ "string" ],                                  // tolerance breaches / info
  "timeline":  [ { "time": "mm:ss", "event": "string" } ],    // post-session only
  "notes":     [ { "author": "...", "createdAt": "iso8601", "note": "..." } ]  // post-session only
}
```

**Scenario keys (stored enum — `sessions.scenario`; renaming later is a
migration):**
`hover` · `straight_level` · `climb_descent` · `turns` · `takeoff_landing`

Metric definitions (key → SimVar, target, tolerance) come from
`BasicHeliTraining.md` and live in `dashboard/shared/js/scenarios.js` as pure
data — the single source of truth the renderer reads. Each scenario defines its
own metric set; there is no one-size metric block.

**Ownership — Adam owns the full slice:** `scenarios.js`, the shared
`report-renderer.js`, and BOTH dashboard rewires (trainee post-session +
trainer live-monitor). Backend (`DashboardReport` EF model, `/live` + `/report`
endpoints, InfluxDB read, grading) and the SimConnect bridge are **deferred
until the pipeline resumes.**

**Ponytails in this area (deliberate simplifications):**
- Stub-fed renderer — ceiling: one canned report / empty live values; upgrade =
  point at the real endpoints (one-line `apiRequest` swap).
- Score shows `—` when `null` — ceiling: card looks empty pre-grading; that IS
  the honest state.
- Polling — ceiling: ~1s freshness; upgrade = SignalR, marked in code.

## Git Workflow

- Feature branches off `dev`: `git checkout -b feature/<name>`. PRs merge into `dev`, never straight to `main`.
- **Never push to another member's branch** (e.g. `feature/mysql-database` is Member 3's) — this caused a forced reset once already.
- Trivial one-line fixes may go directly to `dev`.
- Expect merge conflicts in dashboard files if `dev` moved while you worked — resolve by merging `origin/dev` into your branch locally, keep the newer implementation, fold in any genuinely new features from `dev`.

## Pending External Decisions — Do Not Preempt

- User-data ownership between CockpitSim and the partner CBS HeliControl system (shared vs separate accounts, who owns registration) — unresolved; affects any schema/auth work.
- `ids_logs` table ownership is unresolved with the CBS Cybersecurity subteam — don't assume its schema or access pattern.
- Reference docs (`techstack.md`, `erd.md`, `srs.md`, `architecture.md`) are source-of-truth when present — if a task conflicts with them, flag it instead of overriding silently.
