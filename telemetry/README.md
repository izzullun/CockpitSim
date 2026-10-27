# CockpitSim Telemetry Bridge (MSFS 2020 → InfluxDB)

Samples hover SimVars from the sim at 10–20 Hz and writes them to InfluxDB
(`heli_telemetry` measurement, tags `sessionId` + `scenario`) for the backend
to poll. Same PC as MSFS 2020 by design — everything is localhost.

## Run it (mock — no sim, no Influx needed)

```
dotnet run --project telemetry/CockpitSim.Telemetry -- --dry-run --duration 5
```

Prints raw line protocol to stdout. Proves the sample generator works.

## Run it (mock → your InfluxDB)

```
dotnet run --project telemetry/CockpitSim.Telemetry -- --mock --rate 10
```

No `--session`: the bridge asks the backend for the active session, feeds it,
and goes back to waiting when it ends — one process covers the whole flying
day. Pass `--session <id>` for a single-shot run instead.

Token resolution (first hit wins): `INFLUX_TOKEN` env, then `.env` next to the
repo root or `CockpitSimApp/.env` (both gitignored — never commit them).
The backend, launcher, and bridge share this loader. Development runs from
`backend/CockpitSim/` also find the repo-root file; published programs find
the bundle-root file. The launcher loads it even when the backend is already
running. Restart an existing backend after changing its token: environment
changes do not update a running process.
Without any of those the bridge exits with a clear error instead of failing
mid-run.
```powershell
$env:INFLUX_TOKEN = "<your admin token>"   # only needed if you keep no .env file
```

Defaults: `--influx-url http://localhost:8086 --org cockpitsim --bucket telemetry
--scenario hover`. Override with flags or `INFLUX_URL` / `INFLUX_ORG` /
`INFLUX_BUCKET` env. Ctrl+C stops (flushes the last batch).

## Run it (live sim — needs MSFS SDK)

Install `C:\MSFS SDK`, reference its managed `SimConnect.dll` in
`MsfsSimConnectSource.cs` (the `TODO:` there marks the exact spot), then:

```
dotnet run --project telemetry/CockpitSim.Telemetry -- --session <session-id> --rate 20
```

## Line format (the contract with the backend)

```
heli_telemetry,sessionId=<id>,scenario=hover,source=mock ground_velocity_kt=0.1,radar_alt_ft=5.2,... <ms-epoch>
```
`source` is `mock` (simulated replay) or `sim` (live MSFS 2020) — dashboards
show which feed a session was graded on.

Fields: `ground_velocity_kt, radar_alt_ft, heading_true_deg, vel_body_x,
vel_body_z, vertical_speed_fpm, bank_deg, pitch_deg, collective_pct`.
NaN fields are dropped, never stored as zero.
