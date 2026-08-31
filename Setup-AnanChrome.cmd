@echo off
setlocal
title AnanChrome Project Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-project.ps1"
if errorlevel 1 (
  echo Setup failed. Review the error above.
  pause
  exit /b 1
)
echo Setup complete. Reload AnanChrome once in the browser.
pause
