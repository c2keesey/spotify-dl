# Resolver seed eval

This is a small review set for Spotify-to-YouTube Music matching. Its Spotify
metadata comes from the local exported Spotify library, and its candidate lists
are snapshots of real YouTube Music searches. The runner is offline and
repeatable after capture.

No initial label is gold. The labels marked `provisional` are strong hypotheses;
the `needs_review` cases are deliberately on the fence. Only labels changed to
`gold` contribute to accuracy.

## Review

Render the cases with clickable candidates:

```bash
uv run python scripts/run_resolver_eval.py
```

For each case, listen to the expected candidate and any close alternatives,
then edit its `label` in `v1.json`:

- Set `expected_status` to `verified`, `rejected`, or `ambiguous`.
- Put every acceptable YouTube ID in `expected_video_ids`. Use an empty list
  for a rejected case.
- Record the reason or distinguishing detail in `notes`.
- Set `state` to `gold` only after a human has made the judgment.

Re-run the command to see gold accuracy. Provisional agreement is displayed for
review but excluded from that metric.

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
