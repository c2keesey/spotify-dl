# Resolver seed eval

This is a small review set for Spotify-to-YouTube Music matching. Its Spotify
metadata comes from the local exported Spotify library, and its candidate lists
are snapshots of real YouTube Music searches. The runner is offline and
repeatable after capture.

The initial labels were provisional hypotheses. All nine v1 cases have now been
human-reviewed and marked `gold`; only gold labels contribute to accuracy.

## Review

Launch the interactive reviewer:

```bash
uv run python scripts/review_resolver_eval.py
```

The selected candidate autoplays as a 20-second excerpt starting 30 seconds
into the track. Use the arrow keys (or `hjkl`) to move through candidates and
cases:

- `y` accepts the resolver's result and saves it as gold.
- `v` marks the checked candidate (or the current candidate) verified.
- `r` says none of the captured candidates is the right recording.
- `x` checks multiple acceptable candidates; `a` saves them as ambiguous.
- `u` defers the case, leaving it in `needs_review`.
- `Space` stops playback, `Enter` replays, and `q` exits.

Every classification is atomically persisted to `v1.json`. The TUI requires
either `mpv`, or both `yt-dlp` and `ffplay`; this machine already has the latter
pair.

The non-interactive score report remains available:

```bash
uv run python scripts/run_resolver_eval.py
```

The highest-priority fence cases are:

- `dont-wanna-be-here-combined-artist` and `nasi-goreng-combined-artist`, which
  look like real matches rejected because YouTube combines artists into one
  string.
- `lovin-feeling-duplicate-sources`, which has two indistinguishable source IDs.

The original issue also named “When I am Gone,” but it was not present in the
local Spotify export. It should be added only after its Spotify ID, artist, and
duration are sourced rather than guessed.

## Refresh

YouTube search results can drift. Refreshing is intentionally separate from
evaluation:

```bash
uv run python scripts/capture_resolver_eval.py
```

This replaces candidate snapshots and updates `captured_at`, while preserving
Spotify metadata and labels. Review any label again after a refresh.
