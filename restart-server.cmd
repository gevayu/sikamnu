@echo off
rem Si-kam-nu: reloads the server after a code or .env change. Kills node only; server-loop.cmd starts it again within 5 seconds.
rem Do not run during a recording: the call in progress is cut off.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object CommandLine -like '*src/index.ts*' | ForEach-Object { taskkill /PID $_.ProcessId /F }"
echo Server restarting. It is back within about 5 seconds.
pause
