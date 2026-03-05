# PRPilot

PRPilot is a Telegram webhook service that runs Pi tasks on selected local repositories and can open pull requests to `main`.

It is designed for a single authorized Telegram user, multi-repo selection, and repeatable task boundaries (always reset to clean `main` before and after runs).

## What it does

- Receives Telegram updates via webhook
- Supports repository selection per chat (`/repo <name>`)
- Supports planning/chat runs (free-text)
- Supports apply runs (`/apply`) that:
  - create a feature branch
  - run the agent
  - commit changes
  - push branch
  - open a PR to `main`
- Uses GitHub App auth (JWT + installation token flow)
- Exposes health + Prometheus metrics endpoints

## Quick start (local)

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

Service defaults:
- Main app: `http://localhost:8080`
- Metrics app: `http://localhost:9090/metrics`

## Telegram setup

### 1) Create bot token

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Save returned token as `TELEGRAM_BOT_TOKEN`

### 2) Generate webhook secret

```bash
openssl rand -hex 32
```

Set output as `TELEGRAM_WEBHOOK_SECRET`.

PRPilot validates both:
- webhook URL token segment
- `X-Telegram-Bot-Api-Secret-Token` header

## Configuration

### Required environment variables

| Variable | Example | Notes |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://prpilot.example.com` | Used to register Telegram webhook |
| `TELEGRAM_BOT_TOKEN` | `123456:AA...` | Bot token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | random hex | Webhook path + header validation |
| `TELEGRAM_ALLOWED_USER_ID` | `123456789` | Only this Telegram user is allowed |
| `REPO_OWNER` | `auricom` | GitHub owner/org for PR creation |
| `REPOS_ROOT` | `/workspace` | Repos are resolved as `<REPOS_ROOT>/<repo-name>` |
| `REPO_NAMES` | `repo-one,repo-two` | Allowed repos for `/repo` |
| `REPO_BASE_BRANCH` | `main` | Must be `main` |
| `GITHUB_APP_ID` | `123456` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY_PATH` or `GITHUB_APP_PRIVATE_KEY_PEM` | path or PEM | One is required |

### Optional environment variables

| Variable | Default | Notes |
|---|---|---|
| `GITHUB_APP_INSTALLATION_ID` | auto-discover | Optional explicit installation ID |
| `SESSION_DIR` | `/data/sessions` | Stores selected repos, task history, intents |
| `PORT` | `8080` | Main app port |
| `METRICS_PORT` | `9090` | Metrics app port |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `NODE_ENV` | unset | Use `development` for dev behavior |

## Telegram command guide

- `/repo` — show current repo + supported repos
- `/repo <name>` — select repo for this chat
- `/status` — show health, selected repo, branch, current task
- `/tasks` — show recent task list
- `/task <number>` — show detailed task entry
- `/apply` — apply latest chat plan
- `/apply <task>` — apply explicit task directly
- `/abort` — abort current run
- free-text — starts a chat/planning run

## Execution flow

### Chat run (free-text)

1. Require selected repo (`/repo <name>`)
2. Reset repo to clean `origin/main`
3. Run Pi in `chat` mode
4. Store summary in task history
5. Reset repo to clean `origin/main`

### Apply run (`/apply`)

1. Require selected repo
2. Reset repo to clean `origin/main`
3. Resolve task prompt (explicit task or last chat summary)
4. Create feature branch
5. Run Pi in `apply` mode
6. Commit and push changes
7. Open PR to `main`
8. Reset repo to clean `origin/main`

## Observability

### Health endpoints

- Main app:
  - `GET /healthz`
  - `GET /readyz`
- Metrics app:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`

### Logging

- Structured key/value logs to stderr
- No app-side timestamps (runtime/Kubernetes provides timestamps)
- Request correlation via `requestId`
- Set `LOG_LEVEL=DEBUG` for detailed execution traces

### Prometheus metrics

`/metrics` is served on the separate metrics server (`METRICS_PORT`).

Main app HTTP metrics:
- `http_requests_total{method,route,status_code}`
- `http_request_duration_seconds{method,route,status_code}`

Route labels are templated (for example: `/telegram/webhook/:token`) to avoid high cardinality and secret leakage.

Pi agent behavior metrics:
- `pi_runs_total{mode,result}` (`result`: `success|error|busy|empty-output|aborted`)
- `pi_run_duration_seconds{mode,result}`
- `pi_session_get_total{mode,cache}` (`cache`: `hit|miss`)
- `pi_session_abort_total{result}` (`result`: `aborted|no-active`)
- `pi_sessions_active`
- `pi_session_index_io_errors_total{op}` (`op`: `read|write`)
- `pi_agents_md_load_failures_total`

Superpowers sync metrics:
- `superpowers_skills_fetch_success_total`
- `superpowers_skills_fetch_failure_total`
- `superpowers_skills_fetch_last_success_timestamp_seconds`
- `superpowers_skills_fetch_last_failure_timestamp_seconds`
- `superpowers_skills_fetch_last_attempt_timestamp_seconds`
- `superpowers_skills_fetch_last_duration_seconds`
- `superpowers_skills_fetch_last_status` (`1` success, `0` failure)

### Suggested alerts (when you add alerting)

A ready-to-use rule file is included at `alerts/pi-agent-rules.yaml`.

- **High Pi run failure ratio**
  - `sum(rate(pi_runs_total{result=~"error|aborted|empty-output"}[10m])) / sum(rate(pi_runs_total[10m])) > 0.2`
- **Busy contention spike**
  - `rate(pi_runs_total{result="busy"}[5m]) > 0`
- **Slow Pi runs (p95)**
  - `histogram_quantile(0.95, sum by (le,mode) (rate(pi_run_duration_seconds_bucket[10m]))) > 60`
- **Session index IO errors**
  - `increase(pi_session_index_io_errors_total[15m]) > 0`
- **AGENTS.md load failures**
  - `increase(pi_agents_md_load_failures_total[15m]) > 0`

## Build, test, checks

```bash
npm run build
npm test
npm run check:logging
npm run check
```

## Deployment notes

- Expose main app (`PORT`) publicly for Telegram webhook delivery
- Keep metrics app (`METRICS_PORT`) internal/private for Prometheus scraping
- Never commit bot token, webhook secret, or GitHub private key
- Ensure each repo in `REPO_NAMES` exists at `<REPOS_ROOT>/<name>` and contains `AGENTS.md`

## Troubleshooting

- **Unauthorized in Telegram**: verify `TELEGRAM_ALLOWED_USER_ID`
- **Webhook not receiving updates**: verify `PUBLIC_BASE_URL` and webhook secret
- **Repo selection fails**: check repo exists and is a valid git worktree
- **Apply fails to open PR**: verify GitHub App permissions/installation and `REPO_OWNER`
- **No metrics**: check metrics server port and scrape `http://<host>:<METRICS_PORT>/metrics`
