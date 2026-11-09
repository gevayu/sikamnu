@echo off
rem Si-kam-nu local server. Keep this window open while recording.
rem Normally not needed: the server starts hidden at Windows login (Startup folder).
title Si-kam-nu server
curl.exe -s -m 2 http://localhost:8787/health >nul 2>&1
if %errorlevel%==0 (
  echo Si-kam-nu server is already running on http://localhost:8787
  echo Nothing to do. You can close this window.
  pause
  exit /b 0
)
cd /d "%~dp0server"
node --env-file-if-exists=../.env src/index.ts
pause
