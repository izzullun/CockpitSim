@echo off
REM CockpitSim bridge runner - double-click and it finds the active session itself.
REM Feeds LIVE MSFS 2020 data until you close this window, press Ctrl+C, or the
REM session ends (then it stops by itself). The sim must be running with a
REM flight loaded. Token: INFLUX_TOKEN env or CockpitSimApp/.env - the bridge
REM loads it itself. For simulated data instead, run the exe with --mock.
setlocal
set BRIDGE_EXE=%~dp0telemetry\CockpitSim.Telemetry.exe

if not exist "%BRIDGE_EXE%" goto NOBRIDGE
if not "%~1"=="" goto HAVEARG
title CockpitSim Bridge - auto-attach LIVE
"%BRIDGE_EXE%" --rate 10
goto DONE
:HAVEARG
title CockpitSim Bridge - %~1
"%BRIDGE_EXE%" --session %~1 --rate 10
goto DONE
:NOBRIDGE
echo Bridge not found. Publish it first:
echo   dotnet publish telemetry/CockpitSim.Telemetry -c Release -o CockpitSimApp/telemetry
pause
exit /b 1
:DONE
echo.
echo Bridge stopped.
pause
