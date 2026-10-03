# packaging/ — canonical release bundle contents (tracked in git)

`CockpitSimApp/` is gitignored build output. These files are its
version-controlled source — CI (and manual `Path B` publishes) copies them
into the bundle root:

- `Start-CockpitSim.cmd` — double-click entry point (backend + launcher)
- `Stop-CockpitSim.cmd` — stops backend + bridge
- `Run-Bridge.cmd` — manual bridge fallback (auto-discovers the session)
- `.env.example` — empty token template (real `.env` is created by the user)

Rules: ASCII-only (cmd.exe chokes on Unicode dashes), flat `goto` control
flow (never put parenthesized commands inside `(...)` blocks — see history),
and no secrets in `.env.example`, ever.
