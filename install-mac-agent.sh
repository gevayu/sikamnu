#!/bin/bash
# Si-kam-nu on macOS: installs a LaunchAgent that starts the server hidden at login
# and starts it again 5 seconds after it exits or crashes (KeepAlive). Output goes to server.log.
# No --watch on purpose: a code or .env change does not restart the server in the middle of a recording.
# To load changes, run restart-server.sh. Run this script again after moving the folder or reinstalling node.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
label=com.sikamnu.server
plist="$HOME/Library/LaunchAgents/$label.plist"
node="$(command -v node || true)"
[ -n "$node" ] || { echo "node not found in PATH"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <!-- If another instance already serves the port, wait 30 seconds and exit (launchd checks again)
       instead of crash-looping on EADDRINUSE. Same as server-loop.cmd. -->
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>if curl -s -m 2 http://localhost:8787/health >/dev/null 2>&amp;1; then sleep 30; exit 0; fi; echo "[launchd] \$(date) starting server"; exec "$node" --env-file-if-exists=../.env src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$root/server</string>
  <key>EnvironmentVariables</key>
  <dict>
    <!-- launchd starts with a bare PATH. ffmpeg (Opus) usually lives in Homebrew. -->
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$root/server.log</string>
  <key>StandardErrorPath</key><string>$root/server.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Installed $plist"
echo "Server starts now and at every login. Log: $root/server.log"
