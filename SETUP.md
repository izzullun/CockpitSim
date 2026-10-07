# CockpitSim — Setup & User Guide

How to install CockpitSim on a Windows PC with MSFS 2020, set up its database
and telemetry, fly a graded session, and fix the problems that actually occur.
Safe to delete this file once the team no longer needs it — it is documentation
only and not referenced by any code.

> **Note:** This file is tracked by git, so removing it later means committing
> the deletion (one small commit). It never affects the build.

---

## Path A — Run on a sim PC (no source code needed)

Use this when the PC just needs to *run* the system (e.g. the demo / sim rig).
You do **not** need git, the .NET SDK, or the MSFS SDK on this machine.

### 1. Install prerequisites

| # | What | Why | Notes |
|---|------|-----|-------|
| 1 | **MSFS 2020** + a helicopter flight | The simulator is the data source | Stock Cabri G2 or Bell 407 is fine; you open and fly it yourself |
| 2 | **Steam** signed in (Steam edition) | Needed to run MSFS | Skip for Store edition |
| 3 | **Docker Desktop** | Runs the InfluxDB telemetry database | Start it and wait for "Engine running" |
| 4 | **WebView2 Evergreen Runtime** | The desktop app window is WebView2-based | Preinstalled on most Windows 10/11 — install from Microsoft only if the app complains on launch |

You do **not** need: git, Visual Studio, the .NET SDK *or* runtimes, the MSFS
SDK, or any SimConnect installer. Release builds are self-contained (the .NET
runtime travels inside the app folder); the SimConnect *server* ships inside
MSFS itself and the *client* DLLs travel inside the app folder (see
`telemetry/`).

### 2. Download the app

From the repo's **Releases** page, download the latest
`CockpitSimApp-win-x64.zip` (~190 MB) and unzip it anywhere. Optionally verify
it against the published `.sha256` checksum. First launch shows a Windows
SmartScreen "unknown publisher" prompt (unsigned FYP build) — click through it.
The unzipped **`CockpitSimApp/`** folder contains:

```
CockpitSimApp/
  backend/        API + serves the dashboard (http://localhost:5247)
  backend/dashboard/   the dashboard files served by the backend
  backend/Data/   SQLite database file (created + seeded on first launch)
  launcher/       the double-clickable desktop app (WPF + WebView2)
  telemetry/      MSFS → InfluxDB bridge (auto-started by the app)
  Start-CockpitSim.cmd   double-click to run everything
  Stop-CockpitSim.cmd    stops backend + bridge
  Run-Bridge.cmd  manual bridge fallback (double-click, rarely needed)
  .env            YOUR InfluxDB token (you create this — never share/commit it)
  .env.example    empty template showing the shape
```

> No release yet, or updating between releases? Copy a locally published
> `CockpitSimApp/` folder instead (USB/zip/share — see *Republish* under
> Path B). Either way the folder itself is gitignored: build output plus
> local secrets, never committed. **After updating, close the app first**: stale WebView2 cache
> can otherwise show you old pages (see Troubleshooting).

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
automatically — you never type it into a terminal again. Restart the backend
after creating it (environment is read at startup).

### 5. Launch (double-click, every day after)

1. Start Docker Desktop (wait for "Engine running"), then
   `docker start influxdb-cockpitsim` if it isn't running.
2. Double-click the desktop **CockpitSim** shortcut — the app checks Influx
   (warns, never blocks), starts the backend if needed, starts the telemetry
   bridge, and opens the dashboard. First launch takes ~30s (database migrates
   + seeds itself). **One-time:** create that shortcut by running
   `packaging/New-CockpitSimShortcut.ps1` (it just points at
   `CockpitSimApp/launcher/CockpitSim.Launcher.exe`).
   `Start-CockpitSim.cmd` does the same thing — the shortcut is simply the
   app-icon equivalent.
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

## Flying a graded session (the core loop)

1. **Log in as a trainee** → pre-session page (profile, session history with
   **View report** links on completed rows).
2. **START SESSION** → backend creates an `in_progress` hover session (one
   active at a time — re-clicking takes you to the existing one instead of
   failing) → ongoing page opens.
3. **Read the state pill** — it always tells you exactly where you stand:
   - `SETUP` — backend has no telemetry token (fix: step 4 above + restart).
   - `CONNECTING` — no points in the last 30s. The page shows the session id
     and the exact bridge command for this session when started by hand.
   - `ON TRACK` / `CHECK` — live data is flowing, all/some metrics in
     tolerance. A "simulated feed" note means mock data; its absence means
     your actual stick inputs.
4. **Fly in MSFS 2020** — the app auto-started the bridge, which reads the sim
   ~10×/sec into InfluxDB tagged with your session. The flip to ON TRACK
   within ~2s is your "data is flowing" proof. Get the bridge running within
   the first minute — silent sessions auto-close (see below).
5. **END SESSION** (or just close the app) → grading runs once over the full
   window → report opens automatically:
   - **01 Session summary** — exercise + attempt, PASS (score ≥ 70) pill,
     flight time, completion, score, risk (Low/Medium/High from breach rate).
   - **02 Performance report** — per-metric actuals vs targets/tolerances,
     warning count, trainer notes (once written).
   - **03 Session timeline** — start, first-breach moments (`mm:ss`), graded end.
   - **04 Next actions** — auto-generated verdict + coaching tip for the
     weakest metric, plus "Run another session".
6. **No-telemetry safety net:** a session older than ~90s with 60s of silence
   is auto-ended and graded honestly (`—`, "No telemetry was captured") —
   never fake numbers. Closing the app kills the bridge, so abandoned sessions
   close themselves the same way.

### Trainer loop

Log in as a trainer → roster of assigned trainees, session queue, analytics,
per-trainee session history. **Feedback** on a trainee or session — trainees
read it in their post-session notes. Feedback attaches to the newest session;
notes stay live even though scores are frozen snapshots. Completed reports can
also be read via the API (`GET /api/sessions/{id}/live` with a trainer JWT).

### Telemetry & grading contract (short version)

- Dashboards never touch InfluxDB — always via the backend (owns auth).
- Live = latest values, `score: null`. Post-session = stored snapshot,
  computed once at session-end into `dashboard_reports`, never recomputed.
- Polling (1s hover / 2s cruise), not websockets — matches the training-doc
  rates.
- Scenario keys are stored data: `hover` · `straight_level` · `climb_descent` ·
  `turns` · `takeoff_landing`. Only `hover` has a live metric set and grading
  rubric today — other scenarios start and record, but report "no rubric yet".
- Feed provenance is tagged per point (`mock` vs `sim`) and surfaced in
  warnings, so simulated and real data can never be confused.

### Manual fallbacks (rarely needed)

- **`Run-Bridge.cmd`** — feeds the active session by hand (finds it itself,
  no session id needed). Day-to-day you never touch it since the app spawns
  the bridge itself; keep it for debugging.
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
| App login persistence | `%LocalAppData%\CockpitSim\WebView2` | delete the `WebView2` folder to force fresh login + clear stale pages |
| Backend database | `CockpitSimApp/backend/Data/app.db` | SQLite, auto-migrates + seeds; delete to reset |
| Token file | `CockpitSimApp/.env` | `INFLUX_TOKEN=…`, never shared/committed |
| Bridge auto-start toggle | `CockpitSimApp/launcher/appsettings.json` | `"AutoStartBridge": false` disables it |

---

## Troubleshooting (every entry below happened at least once)

**START SESSION does nothing / "START FAILED"**
- Most common cause: the bundle predates the endpoint — republish the backend
  and re-copy `dashboard/` (Path B), then fully close and reopen the app.
- Second most common: wrong role. Starting requires a **trainee** login —
  trainer/admin gets 403, which the page reports as START FAILED.

**Ongoing page shows old text, session id stays `—`, no bridge command**
- Stale WebView2 cache serving old scripts. Close the app, delete
  `%LocalAppData%\CockpitSim\WebView2`, reopen. Fixed permanently once the
  backend serves no-cache headers (until then, clear after every update).

**Pill stuck on `SETUP` ("backend has no telemetry token")**
- `.env` missing/misnamed (must be exactly `.env` in `CockpitSimApp/`, one
  `INFLUX_TOKEN=…` line, no quotes/spaces) — or backend started before the
  file existed. Fix the file, then Stop + Start so the backend re-reads it.

**Pill stuck on `CONNECTING` ("Bridge not running")**
- No points in 30s. Usual order: start the bridge (it auto-starts with the
  app — check a `CockpitSim.Telemetry` process exists), confirm its window
  says `Attached to session` with the **same id as the page**, then fly.
  A mismatched id means it attached elsewhere — restart it.

**Session auto-ended after ~a minute with nulls**
- Nothing fed it: sessions older than ~90s with 60s of silence auto-close by
  design. Get the bridge running promptly after START SESSION; the report it
  leaves behind ("No telemetry was captured") is the honest empty, not an error.

**Scores are null / actuals are `—`**
- Backend has no token (see `SETUP` above), or the bridge wrote under a
  different session id. Check the report's warnings — they name the cause.

**Values frozen mid-flight**
- Sim link dropped. The bridge prints reconnect attempts in its window and
  resumes by itself; if it exited, reopen the app (or double-click
  `Run-Bridge.cmd`).

**`docker start` fails / Influx unreachable**
- Docker Desktop isn't running or is paused — the starter prints
  `InfluxDB container not started` and continues without telemetry. Unpause /
  start Docker Desktop, `docker start influxdb-cockpitsim`, then relaunch.

**Publish fails: file locked by another process**
- The bundle backend/launcher is still running. Stop it first
  (`Stop-CockpitSim.cmd`), then republish.

**Two backends fight over port 5247**
- Only one backend can bind. Dev (`dotnet run`) and bundle (`Start-` script)
  share the port — stop whichever you aren't using.

**`Run-Bridge.cmd` window opens then instantly closes**
- Read the last line before it closes: missing token and missing backend are
  reported in plain text. Fix what's named, rerun.

---

## Secrets rule (learned the hard way)

Tokens, passwords, and database files are **never committed**. Concretely:
`.env` files (any folder), `*.db` / `*.sqlite`, and the whole `CockpitSimApp/`
folder are gitignored — `git status` must never show them. Before every
commit, run this seatbelt — if it prints anything, stop and remove the secret:

```powershell
git status --short   # source files only: no .env (non-example), no .db, no exes
git diff | Select-String -Pattern "INFLUX_TOKEN=[A-Za-z0-9+/=_-]{20,}"
# must print nothing: <placeholders> can never match it, a real token always does
```

`.env.example` files stay **empty templates** — they document the shape, never
hold real values.

---

## Path B — Full development setup (for contributors, condensed)

You need this only if you change code. Requires **.NET 8 SDK** (any 8.0.x),
git, and — only for the telemetry bridge — the **MSFS SDK at `C:\MSFS SDK`**
(the bridge references its SimConnect client DLLs by that path).

```powershell
git clone https://github.com/dambeepbeep/CockpitSim.git
cd CockpitSim
git checkout dev
git checkout -b feature/<name>   # PRs merge into dev, never main; never push to another member's branch

cd backend/CockpitSim
$env:INFLUX_TOKEN = "<your admin token>"   # bundle starter reads .env for you; dotnet run needs env
dotnet run                      # http://localhost:5247 — profile "http", Development, SQLite + seeds
```

Second terminals (backend first): `dotnet run --project
launcher/CockpitSim.Launcher`, and `dotnet run --project
telemetry/CockpitSim.Telemetry -- --mock --rate 10` for a simulated feed.
`node --check <file.js>` verifies JS. No test suite yet — verify via Swagger.

**Republish the app folder** after code changes (stop the running bundle first):

```powershell
dotnet publish backend/CockpitSim -c Release -o CockpitSimApp/backend
dotnet publish launcher/CockpitSim.Launcher -c Release -o CockpitSimApp/launcher
dotnet publish telemetry/CockpitSim.Telemetry -c Release -o CockpitSimApp/telemetry
Copy-Item -Path "dashboard/*" -Destination "CockpitSimApp/backend/dashboard/" -Recurse -Force
Copy-Item -Path "packaging/*.cmd", "packaging/.env.example" -Destination "CockpitSimApp/" -Force
```

Releases publish the same three projects with `-r win-x64 --self-contained`
(see `.github/workflows/release.yml`) so target PCs need no .NET runtime;
day-to-day local publishes stay framework-dependent for speed.

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
