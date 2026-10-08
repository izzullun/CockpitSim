# packaging/ — canonical release bundle contents (tracked in git)

`CockpitSimApp/` is gitignored build output. These files are its
version-controlled source — CI (and manual `Path B` publishes) copies them
into the bundle root:

- `New-CockpitSimShortcut.ps1` — creates a "CockpitSim" Desktop shortcut that
  launches the whole app (the launcher starts backend + bridge + dashboard
  itself). **This is the day-to-day entry point.** Run once per PC.
- `Start-CockpitSim.cmd` — optional equivalent of the desktop shortcut
  (backend + launcher). The launcher does the same on its own.
- `Stop-CockpitSim.cmd` — stops backend + bridge
- `Run-Bridge.cmd` — manual bridge fallback (auto-discovers the session)
- `.env.example` — empty token template (real `.env` is created by the user)

Rules: ASCII-only (cmd.exe chokes on Unicode dashes), flat `goto` control
flow (never put parenthesized commands inside `(...)` blocks — see history),
and no secrets in `.env.example`, ever.
