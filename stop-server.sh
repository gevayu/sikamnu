#!/bin/bash
# Si-kam-nu: stops the hidden server so launchd does not bring it back. It starts again at the next login.
# Also stops a server started by hand with start-server.sh.
launchctl bootout "gui/$(id -u)/com.sikamnu.server" 2>/dev/null
pid="$(lsof -ti tcp:8787 -sTCP:LISTEN 2>/dev/null)"
[ -n "$pid" ] && kill $pid
echo "Server stopped."
