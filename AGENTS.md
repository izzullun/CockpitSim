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

## Demo Accounts (hardcoded mock users)

Login currently checks an in-memory list in `Controllers/AuthController.cs` (`_mockUsers`) — **not the database**, even though EF Core Identity scaffolding exists in `Data/`:

- `trainer_lim` / `password123` → trainer dashboard
- `trainee_adam` / `password123` → trainee pre-session
- `trainee_siti` / `password123`

Database state: SQLite packages + `ApplicationDbContext` + migration + `Data/app.db` exist, but the **DbContext is NOT registered in Program.cs** and MySQL/Pomelo is the documented production target. Replacing `_mockUsers` with DB-backed auth + user seeding is the known next step — coordinate before restructuring `Data/`.

## Auth Flow (decided, do not change casually)

1. Login → `POST /api/auth/login` → returns JWT + profile (userId, username, fullName, role, assignedTrainerId)
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
- Roles are lowercase everywhere (`trainee`, `trainer`, `admin`) — matching the authorization policies in Program.cs.

## Git Workflow

- Feature branches off `dev`: `git checkout -b feature/<name>`. PRs merge into `dev`, never straight to `main`.
- **Never push to another member's branch** (e.g. `feature/mysql-database` is Member 3's) — this caused a forced reset once already.
- Trivial one-line fixes may go directly to `dev`.
- Expect merge conflicts in dashboard files if `dev` moved while you worked — resolve by merging `origin/dev` into your branch locally, keep the newer implementation, fold in any genuinely new features from `dev`.

## Pending External Decisions — Do Not Preempt

- User-data ownership between CockpitSim and the partner CBS HeliControl system (shared vs separate accounts, who owns registration) — unresolved; affects any schema/auth work.
- `ids_logs` table ownership is unresolved with the CBS Cybersecurity subteam — don't assume its schema or access pattern.
- Reference docs (`techstack.md`, `erd.md`, `srs.md`, `architecture.md`) are source-of-truth when present — if a task conflicts with them, flag it instead of overriding silently.
