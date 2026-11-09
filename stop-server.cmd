@echo off
rem Si-kam-nu: stops the hidden server and its restart loop. It starts again at the next Windows login.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*server-loop.cmd*') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*src/index.ts*') } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }"
pause
