# PRPilot

Telegram webhook service that drives Pi on selected repositories and can open PRs to `main`.

## Phase 1 scope

- Webhook-based Telegram commands
- Single authorized user
- `/repo`, `/apply`, `/abort`, `/status`, `/tasks`, free-text chat
- `/apply` always creates branch + commit + PR to `main`
- GitHub App auth implemented in TypeScript (JWT + GitHub REST API)

## Required environment variables

- `PUBLIC_BASE_URL` (e.g. `https://prpilot.${SECRET_EXTERNAL_DOMAIN}`)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_ALLOWED_USER_ID`
- `REPO_OWNER` (e.g. `auricom`) — single owner for all repos
- `REPOS_ROOT` (e.g. `/workspace`) — derived repo path is `<REPOS_ROOT>/<name>`
- `REPO_NAMES` (e.g. `repo-one,repo-two,repo-three`) — whitelist of selectable repository names
- `LOG_LEVEL` (`DEBUG` | `INFO` | `WARN` | `ERROR`, default: `INFO`)
- `REPO_BASE_BRANCH=main`
- `GITHUB_APP_ID`
- one of:
  - `GITHUB_APP_PRIVATE_KEY_PATH`
  - `GITHUB_APP_PRIVATE_KEY_PEM`

Optional:
- `GITHUB_APP_INSTALLATION_ID`
- `SESSION_DIR` (default: `/data/sessions`)
- `PORT` (default: `8080`)
- `METRICS_PORT` (default: `9090`)

## Telegram setup (bot token + webhook secret)

### Get `TELEGRAM_BOT_TOKEN`

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Run `/newbot` and follow prompts (name + username).
3. BotFather returns a token like `123456789:AA...`.
4. Store it in your secret manager and set `TELEGRAM_BOT_TOKEN`.

### Generate `TELEGRAM_WEBHOOK_SECRET`

Use a long random value (at least 32 chars). Example:

```bash
openssl rand -hex 32
```

Store it in your secret manager and set `TELEGRAM_WEBHOOK_SECRET`.

Notes:
- Do not commit token/secret to git.
- The app uses this secret both in webhook path and Telegram secret header validation.

## Development

```bash
npm install
npm run dev
```

## Repository selection flow

- Select repo with `/repo <name>` (must be in `REPO_NAMES`).
- Selection persists per chat until changed.
- Prompt construction is repository-driven: each run loads `<selected-repo>/AGENTS.md`.
- `AGENTS.md` must exist at the repository root.
- `/apply` and free-text tasks require a selected repository.
- `/repo` (without args) shows current and supported repositories.
- Every task starts from a clean `main` state.
- After each task, repository state is restored to clean `main` for the next task.
- Local uncommitted and untracked changes are discarded by design at task boundaries.

## Build

```bash
npm run build
npm start
```

## Policy checks

```bash
npm run check:logging
```

## Logging

- Logs are written to `stderr`.
- Format is key/value, e.g.:
  - `level=INFO msg="agent listening" port=8080`
- Kubernetes/runtime platform provides timestamp metadata, so the app does not emit its own timestamp field.
- Set `LOG_LEVEL=DEBUG` to enable detailed core-logic diagnostics (session resolution, token refresh, command execution flow, git/PR steps).
- Each webhook request gets a correlation ID (`requestId`) automatically attached to all logs in that request path.
- Sensitive values are redacted from logs and outbound Telegram messages.

## Superpowers skill sync and metrics

- On startup, the service clones `https://github.com/obra/superpowers.git` into `~/.pi/agent/skills` if missing.
- Every 24 hours, it fetches and hard-resets to `origin/main` to keep skills fresh.
- A separate metrics server runs on `METRICS_PORT` and exposes Prometheus metrics at `/metrics`.
- Main app route metrics are exported as:
  - `http_requests_total{method,route,status_code}`
  - `http_request_duration_seconds{method,route,status_code}`
- Route labels are templated (for example, `/telegram/webhook/:token`) and never include raw URL paths.
- Every Telegram-triggered agent run (`chat` and `/apply`) now starts with a mandatory `using-superpowers` skill invocation instruction.
- Fetch health metrics include:
  - `superpowers_skills_fetch_success_total`
  - `superpowers_skills_fetch_failure_total`
  - `superpowers_skills_fetch_last_status` (`1` success, `0` failure)
