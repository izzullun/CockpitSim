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

Remaining DB work: swap SQLite → Pomelo MySQL for production (TODO in `Program.cs` — only the registration + connection string change).

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

## Git Workflow

- Feature branches off `dev`: `git checkout -b feature/<name>`. PRs merge into `dev`, never straight to `main`.
- **Never push to another member's branch** (e.g. `feature/mysql-database` is Member 3's) — this caused a forced reset once already.
- Trivial one-line fixes may go directly to `dev`.
- Expect merge conflicts in dashboard files if `dev` moved while you worked — resolve by merging `origin/dev` into your branch locally, keep the newer implementation, fold in any genuinely new features from `dev`.

## Pending External Decisions — Do Not Preempt

- User-data ownership between CockpitSim and the partner CBS HeliControl system (shared vs separate accounts, who owns registration) — unresolved; affects any schema/auth work.
- `ids_logs` table ownership is unresolved with the CBS Cybersecurity subteam — don't assume its schema or access pattern.
- Reference docs (`techstack.md`, `erd.md`, `srs.md`, `architecture.md`) are source-of-truth when present — if a task conflicts with them, flag it instead of overriding silently.
