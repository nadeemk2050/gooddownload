@echo off
SETLOCAL EnableDelayedExpansion
cd /d "%~dp0"
title NADDOWNLOAD - Local Server

:: Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
  set "raw=%%a"
  set "LOCAL_IP=!raw: =!"
  goto :got_ip
)
:got_ip

echo.
echo =========================================================
echo   NADDOWNLOAD - Starting...
echo =========================================================

:: Kill any existing backend on port 4000
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr :4000 ^| findstr LISTENING') do (
  taskkill /PID %%p /F >nul 2>&1
)

:: Start the backend (listen on ALL interfaces so mobile can reach it)
start "NADDOWNLOAD Engine" cmd /k "cd /d "%~dp0backend" && python server.py"

timeout /t 4 /nobreak >nul

echo.
echo =========================================================
echo   NADDOWNLOAD IS READY
echo =========================================================
echo.
echo   [LAPTOP]  http://localhost:4000
echo.
echo   [MOBILE]  http://!LOCAL_IP!:4000
echo.
echo   Open the mobile URL in your phone browser.
echo   Both devices must be on the same Wi-Fi.
echo =========================================================
echo.
echo   ALSO: Open the Mobile Companion App:
echo   File: %~dp0..\naddownload-mobile\index.html
echo   Set backend address to: !LOCAL_IP!:4000
echo =========================================================
echo.

:: Open the desktop app in browser
start http://localhost:4000

:: Launch the mobile companion HTML in browser too (for reference)
start "" "%~dp0..\naddownload-mobile\index.html"

echo   Server is running. Close this window to STOP the server.
pause >nul
