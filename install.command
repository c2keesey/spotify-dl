#!/bin/bash
# One-time setup for spotify-dl on macOS. Double-click this file in Finder.
# It installs the required tools, Python dependencies, and your Spotify
# credentials, then points you at the app to launch the UI.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
REPO="$(pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }

echo
bold "spotify-dl setup"
echo "Project: $REPO"
echo

# 1. Homebrew ---------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew isn't installed. It's needed to install deno, ffmpeg and uv."
  echo "    Install it by pasting this in Terminal, then re-run this setup:"
  echo '    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  echo
  read -r -p "Press Return to exit."
  exit 1
fi
ok "Homebrew found"

# 2. Tools: deno (required by yt-dlp), ffmpeg (mp3), uv (python) -------------
for tool in deno ffmpeg uv; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool found"
  else
    echo "  installing $tool ..."
    brew install "$tool" && ok "$tool installed" || { warn "failed to install $tool"; exit 1; }
  fi
done

# 3. Python dependencies ----------------------------------------------------
echo "  installing Python dependencies (uv sync) ..."
if uv sync >/dev/null 2>&1; then ok "Python dependencies ready"; else warn "uv sync failed"; exit 1; fi

# 4. Spotify credentials (.env) --------------------------------------------
if [ -f "$REPO/.env" ] && grep -q SPOTIPY_CLIENT_ID "$REPO/.env"; then
  ok "Spotify credentials already set (.env)"
else
  echo
  bold "Spotify API credentials"
  echo "  Get these (free) at https://developer.spotify.com/dashboard —"
  echo "  create an app, then copy its Client ID and Client Secret."
  echo
  read -r -p "  Client ID:     " CID
  read -r -p "  Client Secret: " SECRET
  if [ -n "$CID" ] && [ -n "$SECRET" ]; then
    printf 'SPOTIPY_CLIENT_ID=%s\nSPOTIPY_CLIENT_SECRET=%s\n' "$CID" "$SECRET" > "$REPO/.env"
    ok "Saved credentials to .env"
  else
    warn "Skipped — you can re-run this setup later to add them."
  fi
fi

# 5. Make the launcher app trusted -----------------------------------------
xattr -dr com.apple.quarantine "$REPO/Spotify DL.app" 2>/dev/null
ok "Launcher app ready"

echo
bold "All set!"
echo "  • Open this folder in Finder and double-click \"Spotify DL\" to launch."
echo "  • Drag \"Spotify DL\" onto your Dock to keep it one click away."
echo "  • It opens http://127.0.0.1:8765 in your browser."
echo
read -r -p "Press Return to close."
