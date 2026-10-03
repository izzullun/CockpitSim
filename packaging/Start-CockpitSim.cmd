@echo off
REM CockpitSim single-click starter.
REM Starts the local backend (SQLite, Development) if needed, waits for
REM /api/health, then opens the WPF launcher. Double-click this file.
setlocal
set ASPNETCORE_ENVIRONMENT=Development
set ASPNETCORE_URLS=http://localhost:5247
set BACKEND_DIR=%~dp0backend
set BACKEND_EXE=%BACKEND_DIR%\CockpitSim.exe
set LAUNCHER_EXE=%~dp0launcher\CockpitSim.Launcher.exe
set ENV_FILE=%~dp0.env
set INFLUX_URL=http://localhost:8086

REM Optional token file (one line: INFLUX_TOKEN=<token>). Same variable the
REM bridge uses. Absent = telemetry features show waiting states, nothing breaks.
if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1* delims==" %%A in ("%ENV_FILE%") do (
    if /i "%%A"=="INFLUX_TOKEN" set INFLUX_TOKEN=%%B
  )
)
if not defined INFLUX_TOKEN (
  echo NOTE: no INFLUX_TOKEN in .env - live telemetry will show waiting states.
)

if not exist "%BACKEND_EXE%" (
  echo Backend not found: %BACKEND_EXE%
  echo Re-run publish: dotnet publish backend/CockpitSim -c Release -o CockpitSimApp/backend
  pause
  exit /b 1
)
if not exist "%LAUNCHER_EXE%" (
  echo Launcher not found: %LAUNCHER_EXE%
  echo Re-run publish: dotnet publish launcher/CockpitSim.Launcher -c Release -o CockpitSimApp/launcher
  pause
  exit /b 1
)

REM InfluxDB preflight: best-effort only, never fatal. Dashboard + backend run
REM fine without telemetry (honest waiting states); this just avoids a dead wait.
docker start influxdb-cockpitsim >nul 2>&1
if errorlevel 1 goto NOINFLUX
echo Waiting for InfluxDB (up to 20s)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(20); while((Get-Date) -lt $deadline){ try { $r=Invoke-WebRequest -Uri 'http://localhost:8086/health' -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 goto NOINFLUXRESPONSE
echo InfluxDB is up.
goto INFLUXDONE
:NOINFLUX
echo NOTE: InfluxDB container not started - is Docker Desktop running? Continuing without telemetry.
goto INFLUXDONE
:NOINFLUXRESPONSE
echo NOTE: InfluxDB not responding - continuing without telemetry.
:INFLUXDONE

REM If backend already healthy, skip starting it (keeps "just click it" idempotent).
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:5247/api/health' -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
  echo Backend already running. Opening CockpitSim...
  start "" "%LAUNCHER_EXE%"
  exit /b 0
)

echo Starting CockpitSim backend...
start "CockpitSim Backend" /D "%BACKEND_DIR%" /min "%BACKEND_EXE%"

echo Waiting for backend (up to 30s)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); while((Get-Date) -lt $deadline){ try { $r=Invoke-WebRequest -Uri 'http://localhost:5247/api/health' -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo.
  echo Backend did not respond at http://localhost:5247/api/health
  echo Check the "CockpitSim Backend" window for errors, then retry.
  pause
  exit /b 1
)

echo Backend is up. Opening CockpitSim...
start "" "%LAUNCHER_EXE%"
exit /b 0
