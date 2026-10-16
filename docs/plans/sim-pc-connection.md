# Plan: Robust trainer-PC → sim-PC connection (WPF launcher)

**Status:** planned — not yet executed
**Date:** 2026-10-16

## Problem

`CockpitSimApp/launcher/appsettings.json` hardcodes a stale sim-PC IP
(`10.100.129.163`). DHCP keeps changing the sim PC's address (observed twice in
one session: `10.100.135.104` → `10.100.140.107`), breaking the launcher's
health check and WebView2 dashboard.

## Fix (hostname-based — works across IP changes and different Wi-Fi)

### 1. Edit `CockpitSimApp/launcher/appsettings.json`

```json
"BackendBaseUrl": "http://10.100.129.163:5247"  →  "http://DESKTOP-416DFK8.local:5247"
```

- Keep `AutoStartBackend: false` / `AutoStartBridge: false` (trainer PC —
  those belong on the sim PC).
- No rebuild needed; the launcher reads this file at startup.

### 2. Fix IPv6-first hang in `BackendHost.cs` (`IsBackendHealthyAsync`)

- The hostname resolves to a link-local IPv6 + IPv4; .NET `HttpClient` may
  burn the whole 3s timeout on IPv6 before falling back to IPv4 (observed
  with PowerShell's `Invoke-WebRequest`; curl/browsers handle it fine).
- Fix: resolve the hostname to IPv4 first (or `SocketsHttpHandler` +
  `ConnectCallback` preferring IPv4). ~3 lines.

### 3. Verify

- Run the launcher from `CockpitSimApp/` → health check passes → WebView2
  loads the login page → log in as trainer → dashboard renders.
- Sim PC side stays untouched (backend already binds `0.0.0.0:5247`,
  firewall rule exists).

## Not changing (deliberate)

- `launcher/CockpitSim.Launcher/appsettings.json` (dev copy) stays
  `localhost` — dev launcher runs the backend on the same machine.
- `dashboard/shared/js/api.js` — derives API URL from `window.location`,
  follows the hostname automatically.
- No mDNS/registry/static-IP work — hostname resolution already verified
  working (`{"status":"ok"}` via both `DESKTOP-416DFK8.local` and
  `DESKTOP-416DFK8`).

## Future (production) path, in order

1. DHCP reservation for sim PC MAC `1c-7e-51-a6-b4-f3` (needs router admin)
   or static IP — stops the churn.
2. Proper DNS name on the network instead of `.local` mDNS.
3. Dedicated backend host with static IP + DNS + TLS if this ever goes
   multi-room.

## Reference (verified during diagnosis)

- Sim PC hostname: `DESKTOP-416DFK8`, MAC `1c-7e-51-a6-b4-f3`
- Sim PC IP is DHCP-assigned and changes frequently; hostname always resolves
  to the current address.
- Backend on sim PC: port 5247, binds `0.0.0.0`, `/api/health` returns
  `{"status":"ok"}`.
- Sim PC firewall blocks ICMP (ping) but allows TCP 5247 — ping failing is
  normal, not a connectivity problem.
