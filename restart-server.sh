#!/bin/bash
# Si-kam-nu: reloads the server after a code or .env change.
# Do not run during a recording: the call in progress is cut off.
# Check first that no sikamnu-*.pcm is growing in $TMPDIR.
label="gui/$(id -u)/com.sikamnu.server"
if launchctl print "$label" >/dev/null 2>&1; then
  launchctl kickstart -k "$label"
  echo "Server restarting. It is back within a few seconds."
else
  echo "LaunchAgent not installed. Run install-mac-agent.sh, or stop and start start-server.sh by hand."
fi
