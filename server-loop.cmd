@echo off
rem Si-kam-nu supervisor: runs the server and starts it again 5 seconds after it exits or crashes.
rem Started hidden by start-server-hidden.vbs at Windows login. Output goes to server.log.
rem No --watch on purpose: a code or .env change no longer restarts the server in the middle of a recording.
rem To load changes, run restart-server.cmd (kills node only, this loop brings it back).
cd /d "%~dp0server"
:loop
curl.exe -s -m 2 http://localhost:8787/health >nul 2>&1
if %errorlevel%==0 (
  rem Another instance already serves the port. Check again in 30 seconds instead of crash-looping.
  ping -n 31 127.0.0.1 >nul
  goto loop
)
echo [supervisor] %date% %time% starting server>> "%~dp0server.log"
"C:\Program Files\nodejs\node.exe" --env-file-if-exists=../.env src/index.ts >> "%~dp0server.log" 2>&1
echo [supervisor] %date% %time% server exited with code %errorlevel%, restarting in 5 seconds>> "%~dp0server.log"
ping -n 6 127.0.0.1 >nul
goto loop
