@echo off
REM Stops the locally started CockpitSim backend and any telemetry bridge.
taskkill /IM CockpitSim.exe /T /F
taskkill /IM CockpitSim.Telemetry.exe /T /F
echo Backend and bridge stopped (if they were running).
pause
