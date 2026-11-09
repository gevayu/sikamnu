' Si-kam-nu: runs server-loop.cmd with no console window. The loop restarts the server after a crash.
' A copy of this file lives in the Windows Startup folder, so the server starts at login.
' cmd /c strips the outermost quote pair, hence the extra quotes around the whole line.
Set sh = CreateObject("WScript.Shell")
root = "C:\Users\User\Documents\Claude-Code Rooms\SiKamNu"
sh.Run "cmd /c """"" & root & "\server-loop.cmd""""", 0, False
