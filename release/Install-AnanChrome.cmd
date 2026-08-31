@echo off
setlocal
cd /d "%~dp0"
title AnanChrome Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\setup-bundled.ps1"
if errorlevel 1 (
  echo Setup failed. Please review the error above.
  pause
  exit /b 1
)
echo See README for browser setup instructions.
pause
