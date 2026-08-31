@echo off
setlocal
title AnanChrome Local Model Diagnostic Launcher
set "ANAN_RUNTIME=%LOCALAPPDATA%\AnanChrome\Runtime\AnanChromeRuntime.exe"
if not exist "%ANAN_RUNTIME%" (
    echo Runtime not installed. Run Setup-AnanChrome.cmd once first.
    pause
    exit /b 1
)
REM Use the same automatic models directory and configuration as the extension.
"%ANAN_RUNTIME%" --ensure
if errorlevel 1 (
    echo Startup failed. Review the diagnostic above.
    pause
    exit /b 1
)
echo The model is running in the background. This window may be closed.
pause
