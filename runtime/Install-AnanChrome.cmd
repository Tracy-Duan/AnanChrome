@echo off
setlocal
cd /d "%~dp0"
title AnanChrome Windows Runtime Setup
echo AnanChrome will install the local AI runtime and download the model.
echo The model download is about 5.24 GiB and only happens once.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo Installation completed successfully.
pause
