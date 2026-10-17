# A Design is an ordered list of Edits, not a snapshot

A Design is stored as its Scan ID plus an ordered list of Edits. The room the Mover sees is computed by replaying those Edits over the Scan. We chose this over storing the resulting room state because Claude's output is already a list of Edits. The list also gives us undo, Duplicate Design, a readable Edit history, and an animated replay for the demo, all for free.

## Consequences

- Every Edit type needs replay logic, and replay must be deterministic.
- Edits refer to Originals and Pieces by stable IDs. If an earlier Edit is undone, a later Edit can point at something that no longer exists, for example recoloring a Piece whose placement was undone. Replay skips such Edits and marks them in the history instead of failing.
