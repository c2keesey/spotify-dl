#!/bin/bash
# Per-playlist download cron, created by the web UI (spotify_dl/web.py).
# Usage: web_cron.sh <output_dir> <url> [url...]
# Mirrors sync_cron.sh's environment handling so it works from cron's
# minimal shell: homebrew PATH for deno, .env for Spotify credentials.

set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/web-cron.log"
mkdir -p "$SCRIPT_DIR/logs"

OUTPUT="$1"
shift

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

if [ -x "/opt/homebrew/bin/uv" ]; then
    UV_PATH="/opt/homebrew/bin/uv"
elif [ -x "/usr/local/bin/uv" ]; then
    UV_PATH="/usr/local/bin/uv"
else
    echo "$(date): ERROR - uv not found" >> "$LOG_FILE"
    exit 1
fi

echo "$(date): Downloading to $OUTPUT: $*" >> "$LOG_FILE"
cd "$SCRIPT_DIR"
$UV_PATH run spotify_dl -l "$@" -o "$OUTPUT" -mc 4 -w >> "$LOG_FILE" 2>&1
echo "$(date): Done (exit $?)" >> "$LOG_FILE"
