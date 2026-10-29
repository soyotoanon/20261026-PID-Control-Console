@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (
  echo.
  echo MOT Console could not start. See the startup message and local logs.
  pause
)
endlocal
