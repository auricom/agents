---
name: gh-app-auth
description: "Authenticate the gh CLI using a GitHub App installation token. Use when: gh commands fail with auth errors, GH_TOKEN needs to be set for a GitHub App (not a PAT), or any task requires a short-lived GitHub App token for repo access. Requires: GitHub App ID and a private key (.pem) file."
---

# GitHub App Authentication for gh CLI

Use `.agent/scripts/generate_github_app_token.py` to obtain a GitHub App installation token, then export it as `GH_TOKEN` for the `gh` CLI.

## Prerequisites

The script requires a Python venv with dependencies. Set it up once:

```bash
# Create venv (if not already present)
mise exec -- uv venv .venv

# Install dependencies
mise exec -- uv pip install -r .agent/scripts/requirements.txt --python .venv/bin/python
```

## Generate a Token

```bash
TOKEN=$(.venv/bin/python .agent/scripts/generate_github_app_token.py \
  --app-id <APP_ID> \
  --private-key <PATH_TO_PEM> \
  --owner <OWNER> \
  --repo <REPO>)

export GH_TOKEN="$TOKEN"
```

Token is valid for **1 hour**. After that, re-run the command.

## Authenticate gh CLI

```bash
# Export and use inline
export GH_TOKEN="$TOKEN"
gh auth status          # verify
gh pr list --repo owner/repo
```

Or pass it per-command without exporting:

```bash
GH_TOKEN="$TOKEN" gh api repos/owner/repo
```

## Script Arguments

| Argument | Required | Description |
|---|---|---|
| `--app-id` | Yes | GitHub App ID (found in App settings) |
| `--private-key` | Yes | Path to the `.pem` private key downloaded from App settings |
| `--owner` | Yes | Repository owner (user or org) |
| `--repo` | Yes | Repository name |
| `--installation-id` | No | Skip auto-discovery and use a known installation ID |
| `--verbose` | No | Print debug info to stderr |

## Finding Your App ID & Private Key

- **App ID**: GitHub → Settings → Developer settings → GitHub Apps → your app → General → App ID
- **Private key**: same page → Private keys → Generate a private key → download the `.pem` file
- The script auto-discovers the installation ID from the repo — no need to look it up manually

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Private key not found` | Wrong path to `.pem` | Check `--private-key` path |
| `401 A JSON web token could not be decoded` | Key doesn't match the App ID | Verify the `.pem` fingerprint matches the one shown in App settings |
| `404 Integration not found` | App not installed on the repo | Install the GitHub App on the target repo |
| `ModuleNotFoundError: No module named 'jwt'` | Dependencies not installed | Run the venv setup commands above |
