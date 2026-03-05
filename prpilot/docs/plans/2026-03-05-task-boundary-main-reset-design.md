# Task Boundary Main Reset Design

## Goal
Ensure every task starts from clean `main` and ends by restoring clean `main`.

## Approved Behavior
- Before each new `chat` and `/apply` task, hard reset repository to `origin/main`.
- After each task completes/fails/aborts, hard reset repository to `origin/main`.
- Reset is destructive by design: discard local changes and untracked files.

## Reset Sequence
1. `git fetch origin --prune`
2. `git checkout -B main origin/main`
3. `git reset --hard origin/main`
4. `git clean -fd`

## Error Handling
- Start reset failure: task does not execute; user receives preparation error.
- End reset failure: task result is returned, then user receives restore error.
- Logs include repo name and warn-level boundary reset messages.
