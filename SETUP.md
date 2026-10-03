# CockpitSim — Setup & User Guide

How to install CockpitSim on any Windows PC with MSFS 2020, set up its
database and telemetry, and what you can do with the application once it runs.
Safe to delete this file once the team no longer needs it — it is documentation
only and not referenced by any code.

> **Note:** This file is tracked by git, so removing it later means committing
> the deletion (one small commit). It never affects the build.

---

## Path A — Run on a sim PC (no source code needed, recommended)

Use this when the PC just needs to *run* the system (e.g. the demo / sim rig).
You do **not** need git, the .NET SDK, or the MSFS SDK on this machine.

### 1. Install prerequisites

| # | What | Why | Notes |
|---|------|-----|-------|
| 1 | **MSFS 2020** (Steam or Store) + a helicopter flight | The simulator is the data source | Stock Cabri G2 or Bell 407 is fine |
| 2 | **Steam** signed in (Steam edition) | The app launches the sim through it | Skip for Store edition |
| 3 | **.NET 8 runtimes** — *ASP.NET Core Runtime 8.0.x* (includes the base runtime) | The app folder is framework-dependent, not self-contained | SDK **not** required; any 8.0.x works |
| 4 | **Docker Desktop** | Runs the InfluxDB telemetry database | Start it and wait for "Engine running" |
| 5 | **WebView2 Evergreen Runtime** | The desktop app window is WebView2-based | Preinstalled on most Windows 10/11 — install from Microsoft only if the app complains on launch |

You do **not** need: git, Visual Studio, the MSFS SDK, or any SimConnect
installer. The SimConnect *server* ships inside MSFS itself; the *client*
DLLs travel inside the app folder (see `telemetry/`).

### 2. Copy the app folder

Copy the **`CockpitSimApp/`** folder onto the PC (USB, zip, network share —
any method). It contains:

```
CockpitSimApp/
  backend/        API + serves the dashboard (http://localhost:5247)
  backend/dashboard/   the dashboard files served by the backend
  backend/Data/   SQLite database file (created + seeded on first launch)
  launcher/       the double-clickable desktop app (WPF + WebView2)
  telemetry/      MSFS → InfluxDB bridge (auto-started by the app)
  Start-CockpitSim.cmd   double-click to run everything
  Stop-CockpitSim.cmd    stops backend + bridge
  .env            YOUR InfluxDB token (you create this — never share/commit it)
  .env.example    empty template showing the shape
```

> The folder is gitignored on purpose — it is build output plus local secrets,
> never committed. Re-copy it (or re-publish — see Path B) whenever the app
> is updated.

### 3. Create InfluxDB (one command)

In PowerShell (Docker Desktop running first):

```powershell
docker run -d `
  --name influxdb-cockpitsim `
  -p 8086:8086 `
  -v influxdb-cockpitsim-data:/var/lib/influxdb2 `
  -e DOCKER_INFLUXDB_INIT_MODE=setup `
  -e DOCKER_INFLUXDB_INIT_USERNAME=admin `
  -e DOCKER_INFLUXDB_INIT_PASSWORD=<pick-a-strong-password> `
  -e DOCKER_INFLUXDB_INIT_ORG=cockpitsim `
  -e DOCKER_INFLUXDB_INIT_BUCKET=telemetry `
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=<paste-a-long-random-string> `
  influxdb:2.7
```

Save the **username, password, org, and admin token**. Verify:
`docker ps` shows it `Up`, and `http://localhost:8086` opens the Influx login.
After a reboot: `docker start influxdb-cockpitsim`.

> Pinned `influxdb:2.7` on purpose — the app speaks the v2 API. Do not use
> `latest`/3.x images; the APIs differ.

### 4. Store the token (one file, one line)

In the `CockpitSimApp` folder create a file named exactly **`.env`** with:

```
INFLUX_TOKEN=<your admin token from step 3>
```

No quotes, no spaces, nothing else. The backend and the bridge both read it
automatically — you never type it into a terminal again.

### 5. Launch (double-click, every day after)

1. Start Docker Desktop (wait for "Engine running"), then
   `docker start influxdb-cockpitsim` if it isn't running.
2. Double-click **`Start-CockpitSim.cmd`**. It checks Influx (warns, never
   blocks), starts the backend if needed, waits for healthy, and opens the app.
   First launch takes ~30s (database migrates + seeds itself).
3. Log in (demo accounts below).

**Reset demo data:** stop everything (`Stop-CockpitSim.cmd`), delete
`CockpitSimApp/backend/Data/app.db`, relaunch — it regenerates and re-seeds.

**Verify it works:**

- `http://localhost:5247/api/health` → `{"status":"ok"}`
- `http://localhost:5247/swagger` — interactive API docs
- Login page in the app (or `http://localhost:5247/dashboard/login/login.html`)

### Demo accounts (seeded automatically on first launch)

| Username | Password | Goes to |
|---|---|---|
| `trainee_adam` | `Adam123!` | trainee pre-session |
| `trainee_faris` | `Faris123!` | trainee pre-session |
| `trainee_syafiq` | `Syafiq123!` | trainee pre-session |
| `trainee_danish` | `Danish123!` | trainee pre-session |
| `trainer_azlan` | `Azlan123!` | trainer dashboard (owns adam, faris) |
| `trainer_hakim` | `Hakim123!` | trainer dashboard (owns syafiq, danish) |

---

## What you can do with the application (full tour)

Everything below runs on **localhost** — no firewall changes, no accounts,
no internet (after installs) needed.

### Trainee loop — fly and get graded (the core experience)

1. **Log in as a trainee** → pre-session page (profile, assigned session,
   session history with **View report** links on completed rows).
2. **START SESSION** → backend creates an `in_progress` hover session (one
   active at a time; re-clicking picks up the existing one) → ongoing page
   opens: exercise, live elapsed timer, tolerance indicator, warning count.
3. **Fly in MSFS 2020** — load the helicopter, lift into a hover and hold it.
   The app auto-started the telemetry bridge, which reads the sim ~10×/sec
   (ground/vertical speed, radar altitude, heading, bank/pitch, collective,
   on-ground state) into InfluxDB, tagged with your session. The page flips to
   ON TRACK within ~2s — that flip is your "data is flowing" proof. No
   "simulated feed" note means the numbers are your actual stick inputs.
4. **END SESSION** (or just close the app) → grading runs once over the full
   window → report opens automatically:
   - **01 Session summary** — exercise + attempt, PASS (score ≥ 70) pill,
     flight time, completion, score, risk (Low/Medium/High from breach rate).
   - **02 Performance report** — per-metric actuals vs targets/tolerances,
     warning count, trainer notes (once written).
   - **03 Session timeline** — start, first-breach moments (`mm:ss`), graded end.
   - **04 Next actions** — auto-generated verdict + coaching tip for the
     weakest metric, plus "Run another session".
5. **No-telemetry safety net:** a session older than ~90s with 60s of silence
   is auto-ended and graded honestly (`—`, "No telemetry was captured") —
   never fake numbers. Closing the app kills the bridge, so abandoned sessions
   close themselves the same way.

### Trainer loop — watch live, leave feedback

1. **Log in as a trainer** → roster of assigned trainees, session queue,
   analytics, and per-trainee session history.
2. **Feedback** on a trainee or session — trainees read these in their
   post-session notes. Feedback attaches to the newest session; notes are
   annotations and stay live even though scores are frozen.
3. Trainers can also read any completed report through the same stored
   snapshots (e.g. via the API: `GET /api/sessions/{id}/live` for the latest
   values of a session with a trainer JWT).

> Pending slice: the trainer dashboard's live-monitor panel still shows
> placeholders — second-by-second polling of `/live` for the selected
> trainee's active session is designed but not yet wired. The endpoint it
> will read is already live and verified.

### Telemetry & grading contract (short version)

- Dashboards never touch InfluxDB — always via the backend (owns auth).
- Live = latest values, `score: null`. Post-session = stored snapshot,
  computed once at session-end into `dashboard_reports`, never recomputed.
- Polling (1s hover / 2s cruise), not websockets — matches the training-doc
  rates; sub-second alerts would be the only reason to upgrade.
- Scenario keys are stored data: `hover` · `straight_level` · `climb_descent` ·
  `turns` · `takeoff_landing`. Only `hover` has a live metric set and grading
  rubric today — other scenarios start and record, but report "no rubric yet".
- Feed provenance is tagged per point (`mock` vs `sim`) and surfaced in
  warnings, so simulated and real data can never be confused.

### Manual fallbacks (when automation isn't enough)

- **`Run-Bridge.cmd`** (in `CockpitSimApp`) — feeds the active session
  manually (auto-discovers it, no session id needed). Kept for debugging;
  day-to-day you never touch it since the app spawns the bridge itself.
- **Simulated feed for testing without the sim:**
  `CockpitSim.Telemetry.exe --mock --rate 10` (or `dotnet run --project
  telemetry/CockpitSim.Telemetry -- --mock …` from source). Points carry
  `source=mock` and dashboards label them.
- **`Stop-CockpitSim.cmd`** — stops backend + bridge.

### Ports & files cheat-sheet

| What | Where | Notes |
|---|---|---|
| Dashboard + API | `http://localhost:5247` | set in `appsettings.json` (`Urls`) + launcher config |
| InfluxDB | `http://localhost:8086` | Docker `-p 8086:8086` |
| App login persistence | `%LocalAppData%\CockpitSim\WebView2` | delete to force a fresh login/cache |
| Backend database | `CockpitSimApp/backend/Data/app.db` | SQLite, auto-migrates + seeds; delete to reset |
| Token file | `CockpitSimApp/.env` | `INFLUX_TOKEN=…`, never shared/committed |
| Bridge auto-start toggle | `CockpitSimApp/launcher/appsettings.json` | `"AutoStartBridge": false` disables it |

---

## Path B — Full development setup (for contributors)

You need this only if you change code. Requires **.NET 8 SDK** (any 8.0.x;
check with `dotnet --list-sdks`), git, and — only for the telemetry bridge —
the **MSFS SDK at `C:\MSFS SDK`** (the bridge references its SimConnect
client DLLs by that path; the app itself needs no SDK).

```powershell
git clone https://github.com/dambeepbeep/CockpitSim.git
cd CockpitSim
git checkout dev
git checkout -b feature/<name>   # PRs merge into dev, never main

cd backend/CockpitSim
dotnet restore
dotnet run                      # http://localhost:5247 — profile "http"
                                # Swagger: http://localhost:5247/swagger
```

`dotnet run` uses the `http` profile (`ASPNETCORE_ENVIRONMENT=Development`):
SQLite + auto-migrations + demo seeding, same as Path A. Telemetry needs the
token in the environment (only the bundle starter reads `.env` files for you):

```powershell
$env:INFLUX_TOKEN = "<your admin token>"
dotnet run   # from backend/CockpitSim; the http profile sets Development
```

Without it the backend runs fine but live views show waiting states and
grading stores null scores. Verify with the health/login URLs and demo
accounts above.

**Run the pieces from source** (second terminal each, backend first):

```powershell
dotnet run --project launcher/CockpitSim.Launcher        # desktop app (needs backend up)
dotnet run --project telemetry/CockpitSim.Telemetry -- --mock --rate 10   # simulated feed, auto-attaches
```

**Republish the app folder** after code changes (stop the running bundle first —
Windows locks running exes):

```powershell
dotnet publish backend/CockpitSim -c Release -o CockpitSimApp/backend
dotnet publish launcher/CockpitSim.Launcher -c Release -o CockpitSimApp/launcher
dotnet publish telemetry/CockpitSim.Telemetry -c Release -o CockpitSimApp/telemetry
Copy-Item -Path "dashboard/*" -Destination "CockpitSimApp/backend/dashboard/" -Recurse -Force
```

**Verify JS syntax without serving:** `node --check <file.js>`.
No test suite exists yet — verify backend changes via Swagger.

## Path C — Production database (MySQL)

Only for deploying against MySQL. Requires MySQL Server + `dotnet ef`
(`dotnet tool install --global dotnet-ef`).

The backend will **not** auto-create the MySQL schema (checked-in EF migrations
are SQLite-only). Provision it first, then supply credentials via environment
variable — never commit a password:

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
that the EF model (`ApplicationUser`) does not map, and the newer
`dashboard_reports` table needs a matching MySQL migration set. The cleaner fix
is generating proper MySQL EF migrations so EF owns the schema (see AGENTS.md,
"Production provisioning"). Also supply the Influx token and MySQL password via
environment on the host — same rule as `.env`: never in source control.
