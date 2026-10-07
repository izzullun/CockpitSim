# CockpitSim Launcher

The CockpitSim desktop app. This is what trainees and trainers actually open on
the PC — instead of typing a website address into a browser, they just
double-click the CockpitSim icon and the app opens in its own window.

**One click runs everything.** Double-clicking the app (the desktop
**CockpitSim** shortcut, or `CockpitSim.Launcher.exe` directly) starts the
backend if needed, warms InfluxDB, starts the telemetry bridge, and opens the
dashboard — you don't need `Start-CockpitSim.cmd` day-to-day. To create the
desktop shortcut, run `packaging/New-CockpitSimShortcut.ps1` once (see
`packaging/README.md`).

Behind the scenes the app shows the same dashboard website as before, just
inside a dedicated window. This means any updates made to the dashboard
automatically appear in the app too — nothing extra to maintain.

## What you need installed

- .NET 8 SDK (the same one the backend uses)
- The CockpitSim backend must be running, otherwise the app shows a
  "cannot reach the server" screen with a Retry button

## Run it (while developing)

1. Start the backend first:

   ```
   dotnet run --project backend/CockpitSim
   ```

2. Then start the app:

   ```
   dotnet run --project launcher/CockpitSim.Launcher
   ```

## Make a shareable version

```
dotnet publish launcher/CockpitSim.Launcher -c Release
```

The ready-to-use `CockpitSim.Launcher.exe` ends up in
`launcher/CockpitSim.Launcher/bin/Release/net8.0-windows/publish/`.
You can copy that folder to another PC or make a desktop shortcut to it.

## Changing where the app connects

By default the app expects the backend at `http://localhost:5247`. If the
backend ever runs on a different address or port, edit `appsettings.json`
(next to the exe) — no need to rebuild the app.

## Notes

- The app launches MSFS 2020 for you: when a trainee presses **START SESSION**,
  the dashboard tells the app over WebView2 messaging and the app opens the sim
  through Steam (`steam://rungameid/1250410`). No Steam.exe/MSFS paths are
  hardcoded — the Steam URI handler does the work, and no Steam GUI is
  automated. The app keeps running while you fly, watches the simulator
  process, and when MSFS closes it tells the dashboard so the session ends and
  the report is generated automatically. Configure via `appsettings.json`:
  `SimulatorAppId`, `SimulatorProcessNames` (defaults MSFS 2020), and
  `AutoLaunchSimulator` (`false` leaves launching manual). MSFS 2024 can be
  added later by extending those values.
- The app auto-starts the telemetry bridge as a hidden child process (mock
  hover feed, self-discovers the active session — no session id needed) and
  stops it on exit. Disable with `"AutoStartBridge": false` in
  `appsettings.json`. If the bridge exe is missing, the app runs on without
  telemetry.
- The app remembers your login between launches (you stay signed in like a
  normal desktop app).
- When the backend is deployed as a Windows Service on the demo PC, it starts
  automatically on boot — so the desktop shortcut is the only thing anyone
  ever needs to click.
