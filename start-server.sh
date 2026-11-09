#!/bin/bash
# Si-kam-nu local server in the foreground. Keep this window open while recording.
# Normally not needed: install-mac-agent.sh starts the server hidden at login.
if curl -s -m 2 http://localhost:8787/health >/dev/null 2>&1; then
  echo "Si-kam-nu server is already running on http://localhost:8787"
  exit 0
fi
cd "$(dirname "$0")/server"
exec node --env-file-if-exists=../.env src/index.ts
