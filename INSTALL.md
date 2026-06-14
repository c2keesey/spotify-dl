# Installing spotify-dl (macOS)

A little app that downloads Spotify/SoundCloud playlists and tracks. You paste
links in your browser and it saves the music to a folder you choose.

## One-time setup

1. **Get the project** — clone or copy this folder somewhere it can live, e.g.
   your home folder or Documents (not Downloads — things there get cleaned up).
   ```
   git clone https://github.com/c2keesey/spotify-dl.git
   ```
2. **Run the installer** — open the `spotify-dl` folder in Finder and
   **double-click `install.command`**. A Terminal window opens and it:
   - installs the tools it needs (`deno`, `ffmpeg`, `uv`) via Homebrew,
   - installs the Python dependencies,
   - asks for your Spotify API credentials and saves them.

   > If it says Homebrew isn't installed, follow the one line it prints, then
   > run `install.command` again.

   > **Spotify credentials** are free: go to
   > <https://developer.spotify.com/dashboard>, create an app, and copy its
   > **Client ID** and **Client Secret** when the installer asks.

That's it — you only do this once.

## Launching it

- Double-click **`Spotify DL`** (the green music-note app) in the project folder.
- It opens **http://127.0.0.1:8765** in your browser. Paste links, pick a save
  folder, hit Download.
- **Tip:** drag **`Spotify DL`** onto your Dock so it's always one click away.
  (Keep the app inside the project folder; the Dock just points to it.)

## What gets installed

Everything is standard and lives in Homebrew — nothing custom touches your system:

| Tool | Why |
|------|-----|
| `deno` | yt-dlp needs it to fetch from YouTube |
| `ffmpeg` | converts audio to MP3 + tags it |
| `uv` | runs the Python app and its dependencies |

## If something goes wrong

- **"First-time setup needed" / "Missing credentials"** when you click the app →
  run `install.command` first.
- **App won't open ("unidentified developer")** → right-click the app → **Open**
  → **Open**. (Only needed once; or the installer clears this for you.)
- **Downloads fail** → make sure `deno` is installed (`brew install deno`), then
  try again. See `logs/web-ui.log` in the project folder for details.
