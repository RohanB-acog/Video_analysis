#!/bin/bash

# Log the command being executed for debugging
echo "[Docker Wrapper] Executing: $@"

# Check if the command is "docker compose up" or "docker compose up -d"
if [[ "$1" == "compose" && ( "$2" == "up" || "$2" == "up -d" ) ]]; then
  echo "[Docker Wrapper] Skipping 'docker compose up' command as services are already running."
  exit 0
fi

# Execute the original docker command for all other cases
exec /usr/bin/docker "$@"
