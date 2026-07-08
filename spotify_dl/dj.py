"""Pure DJ math: Camelot key mapping, transition compatibility, track energy.

No rekordbox dependency here — everything is unit-testable in isolation.
"""

# rekordbox key name (both sharp and flat spellings) -> Camelot code.
# Minor keys are the A ring, major keys the B ring.
CAMELOT = {
    "Abm": "1A", "G#m": "1A", "B": "1B",
    "Ebm": "2A", "D#m": "2A", "F#": "2B", "Gb": "2B",
    "Bbm": "3A", "A#m": "3A", "Db": "3B", "C#": "3B",
    "Fm": "4A", "Ab": "4B", "G#": "4B",
    "Cm": "5A", "Eb": "5B", "D#": "5B",
    "Gm": "6A", "Bb": "6B", "A#": "6B",
    "Dm": "7A", "F": "7B",
    "Am": "8A", "C": "8B",
    "Em": "9A", "G": "9B",
    "Bm": "10A", "D": "10B",
    "F#m": "11A", "Gbm": "11A", "A": "11B",
    "Dbm": "12A", "C#m": "12A", "E": "12B",
}


def to_camelot(key_name):
    """Camelot code for a rekordbox key name, or None if unknown/missing."""
    if not key_name:
        return None
    return CAMELOT.get(key_name.strip())
