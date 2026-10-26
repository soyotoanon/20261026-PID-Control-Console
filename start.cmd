@echo off
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONDONTWRITEBYTECODE=1
if exist "D:\mamba\python.exe" (
  "D:\mamba\python.exe" server.py --open
) else (
  python server.py --open
)
if errorlevel 1 (
  echo.
  echo MOT Console could not start. Read the error above.
  pause
)
endlocal
