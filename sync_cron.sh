#!/bin/bash
# Spotify sync cron script - runs at 3am daily

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/sync.log"
CONFIG_FILE="$SCRIPT_DIR/sync_config.json"

# Ensure logs directory exists
mkdir -p "$SCRIPT_DIR/logs"

echo "$(date): Starting spotify-dl sync" >> "$LOG_FILE"

# Load environment variables from .env file
if [ -f "$SCRIPT_DIR/.env" ]; then
    echo "$(date): Loading environment variables from .env" >> "$LOG_FILE"
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
else
    echo "$(date): WARNING - No .env file found at $SCRIPT_DIR/.env" >> "$LOG_FILE"
fi

# Verify required env vars
if [ -z "$SPOTIPY_CLIENT_ID" ] || [ -z "$SPOTIPY_CLIENT_SECRET" ]; then
    echo "$(date): ERROR - SPOTIPY_CLIENT_ID or SPOTIPY_CLIENT_SECRET not set" >> "$LOG_FILE"
    exit 1
fi

# Find uv
if [ -x "/opt/homebrew/bin/uv" ]; then
    UV_PATH="/opt/homebrew/bin/uv"
elif [ -x "/usr/local/bin/uv" ]; then
    UV_PATH="/usr/local/bin/uv"
else
    echo "$(date): ERROR - uv not found" >> "$LOG_FILE"
    exit 1
fi

echo "$(date): Using uv at $UV_PATH" >> "$LOG_FILE"

# Run sync
cd "$SCRIPT_DIR"
$UV_PATH run spotify_dl --sync --config "$CONFIG_FILE" >> "$LOG_FILE" 2>&1

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "$(date): Sync completed successfully" >> "$LOG_FILE"
else
    echo "$(date): Sync failed with exit code $EXIT_CODE" >> "$LOG_FILE"
fi

exit $EXIT_CODE
