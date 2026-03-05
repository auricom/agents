# Multi-Repository Support Design (Telegram Pi Agent)

## Goal
Enable the bot to operate on multiple repositories for a single GitHub owner, with an explicit whitelist from one environment variable and a per-chat repository selection command.

## Requirements (Approved)
- Whitelist repository names in one env var.
- Derive repository metadata from selected name:
  - `repoName = name`
  - `repoPath = ${REPOS_ROOT}/${name}`
  - `repoOwner = REPO_OWNER` (single owner globally)
- Add command to select active repository.
- Repository selection persists per chat until changed.
- Every new task requires a selected repository.
- Command menu descriptions should mention supported repositories.

## Configuration Model
Replace single-repo runtime assumptions with multi-repo config:
- `REPO_OWNER`: single owner for all repos.
- `REPOS_ROOT`: base directory containing repositories.
- `REPO_NAMES`: comma-separated whitelist (`home-ops,infra,docs`).
- `REPO_BASE_BRANCH`: global base branch (`main`).

Validation:
- `REPO_NAMES` must parse to a non-empty unique list.
- names are trimmed and normalized.
- selection-time checks ensure derived path exists and is a Git repo.

## Command UX
New command:
- `/repo`:
  - show current selected repository for this chat
  - show supported repositories
- `/repo <name>`:
  - validate against whitelist
  - validate repo path/git directory
  - store selection for this chat and confirm

Task gating:
- free-text chat tasks and `/apply` require selected repository.
- if missing, bot responds with clear instruction and supported list.

Status/task presentation:
- `/status` includes selected repository.
- `/tasks` lines include repository name for each task.

## Runtime Architecture
Introduce derived repository context resolved per incoming message:
- `name`, `owner`, `path`, `baseBranch`

Execution and sessions:
- Pi session cache key becomes `chatId:mode:repoName`.
- Pi tools/session cwd use selected repo path.
- Git/PR operations use the resolved repo context instead of global singleton repo fields.

## Error Handling
- Unsupported `/repo <name>`: reject + show supported names.
- Missing repo selection for task commands: reject + show `/repo <name>` guidance.
- Invalid derived repo path or non-git repo: reject with actionable message.

## Testing Strategy
- Unit: parse `/repo`, `/repo <name>`.
- Integration:
  - chat/apply blocked until repo selected
  - `/repo <name>` enables task flow
  - `/status` reflects selection
  - `/tasks` includes repo names
  - invalid selection path/unknown name handling

## Non-Goals
- Multiple owners.
- Per-repo base branch differences.
- Persisting selected repo across process restart.
