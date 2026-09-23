# CockpitSim — Local Setup

How to get the project running on a fresh machine. Safe to delete this file
once the team no longer needs it — it is documentation only and not referenced
by any code.

> **Note:** This file is tracked by git, so removing it later means committing
> the deletion (one small commit). It never affects the build.

## What you need

- **.NET 8 SDK** (any 8.0.x — the repo does not pin a version). Check with
  `dotnet --list-sdks`.
- **MySQL Server + `dotnet ef`** — only for Phase 2 (production database).
  Not needed for normal development.

## Phase 1 — Development (SQLite, zero DB setup)

This is the normal way to run the project. It uses a local SQLite file that
**creates and seeds itself** on first run — you do not copy a database from
anywhere.

```powershell
git clone https://github.com/dambeepbeep/CockpitSim.git
cd CockpitSim
git checkout feature/mysql-migration   # or dev, once merged

cd backend/CockpitSim
dotnet restore
dotnet run
```

`dotnet run` uses the `http` profile, which sets
`ASPNETCORE_ENVIRONMENT=Development`. That selects SQLite and auto-applies the
migrations + seeds the demo users on startup.

**Verify it works:**

- `http://localhost:5247/swagger` — interactive API docs
- `http://localhost:5247/api/health` → `{"status":"ok"}`
- Login page: `http://localhost:5247/dashboard/login/login.html`
  - `trainee_adam` / `Adam123!` → trainee pre-session
  - `trainer_azlan` / `Azlan123!` → trainer dashboard

**Optional — run the WPF launcher** (in a second terminal, backend still running):

```powershell
dotnet run --project launcher/CockpitSim.Launcher
```

**Reset the demo data:** stop the backend, delete `backend/CockpitSim/Data/app.db`,
then `dotnet run` again. It regenerates and re-seeds.

## Phase 2 — Production database (MySQL)

Only needed when deploying against MySQL. Requires MySQL Server installed and
running, plus the EF Core tool:

```powershell
dotnet tool install --global dotnet-ef
```

The backend will **not** auto-create the MySQL schema (the checked-in EF
migrations are SQLite-only). Provision it first, then supply credentials via
environment variable — never commit a password:

```powershell
# 1. Create the database + tables, and a least-privilege app user (not root)
mysql -u root -p < database/mysql/cockpitsim_schema.sql

# 2. Point the app at MySQL with the app user's password
$env:ConnectionStrings__MySqlConnection = "Server=localhost;Port=3306;Database=cockpitsim;User=cockpitsim_app;Password=<secret>;"

# 3. Run in Production
$env:ASPNETCORE_ENVIRONMENT = "Production"
dotnet run
```

**Known gap to resolve before prod is "done":** the hand-written
`database/mysql/cockpitsim_schema.sql` has a `CreatedAt` column on `AspNetUsers`
that the EF model (`ApplicationUser`) does not map. Reconcile the two — the
cleaner fix is generating a proper MySQL EF migration set so EF owns the schema
(see AGENTS.md, "Production provisioning").
