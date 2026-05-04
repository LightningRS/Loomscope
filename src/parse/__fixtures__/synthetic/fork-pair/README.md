# Fork pair fixture (v0.8 M2)

A pair of mock CC `/branch` jsonls used by the fork closure + merge tests.

## Layout

- `aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa.jsonl` — **original** session
  with 3 ChatNodes (p1 / p2 / p3)
- `bbbbbbbb-1111-2222-3333-bbbbbbbbbbbb.jsonl` — **fork** session created
  by `/branch` after p2: copies p1 + p2 with `forkedFrom` markers, adds
  a NEW p4f ChatNode (different prompt continued from a2), and finally
  appends a `{type:"custom-title"}` record with `"list files (Branch)"`.

## Why the chosen shape

- Tests the `findForkClosure` BFS in both directions: walking from the
  fork session sees its parent (forward), walking from the original
  session sees its child (reverse).
- After uuid-dedup merge, p2 has TWO children (p3 from original,
  p4f from fork) — exercises the sibling-fork visualization path.
- Custom-title only on the fork demonstrates that the merged ChatFlow's
  `customTitle` policy (entry session's title wins) works both ways.
- `forkedFrom.messageUuid` per-record uses each record's own uuid (CC
  `/branch` preserves uuids), so only `sessionId` is uniform across
  the bucket — exercises the M1 fix.

## Not in scope

- compact_boundary / scheduled_task_fire / sub-agents — those have
  their own fixtures. This one is intentionally the minimal shape that
  exercises fork-only logic.
