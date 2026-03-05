# Multi-Repository Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-repository runtime support with whitelist-based repo selection via Telegram.

**Architecture:** Replace singleton repository config with derived per-repo context and a persistent per-chat selection map. Route all chat/apply/git/session behavior through selected repo context, and gate task commands until a repo is selected.

**Tech Stack:** TypeScript, Express webhook handler, Vitest, Supertest.

---

### Task 1: Extend command parsing for repository selection

**Files:**
- Modify: `src/telegram/commands.ts`
- Test: `tests/unit/telegram-commands.test.ts`

**Step 1: Write the failing test**
Add tests asserting:
- `/repo` -> `{ type: "repo" }`
- `/repo home-ops` -> `{ type: "repo", name: "home-ops" }`

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/unit/telegram-commands.test.ts`
Expected: FAIL with missing `repo` command parsing.

**Step 3: Write minimal implementation**
Update `BotCommand` union and `parseCommand` for `/repo` and `/repo <name>`.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/unit/telegram-commands.test.ts`
Expected: PASS.

### Task 2: Add multi-repo config model and parser

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`

**Step 1: Write the failing test**
Use integration-driven failure in `tests/integration/webhook.test.ts` by updating config fixture to new required fields.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: FAIL due to outdated `AppConfig` fields.

**Step 3: Write minimal implementation**
- Replace `repoPath/repoName` config fields with `reposRoot/repoNames`.
- Parse `REPO_NAMES` from one env var into unique list.

**Step 4: Run tests to verify it passes**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: compile/tests green for config fixture compatibility.

### Task 3: Introduce repository resolution and selection command flow

**Files:**
- Modify: `src/app.ts`
- Test: `tests/integration/webhook.test.ts`

**Step 1: Write the failing test**
Add tests for:
- free-text task blocked without selection
- `/repo home-ops` sets selection
- free-text task works after selection
- `/status` includes selected repo

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: FAIL because selection and gating are missing.

**Step 3: Write minimal implementation**
- Add per-chat `selectedRepoByChatId` map.
- Add handlers for `/repo` and `/repo <name>`.
- Gate `chat` and `apply` when no selected repo.
- Include repo in status/task output.

**Step 4: Run tests to verify it passes**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: PASS.

### Task 4: Route all runtime git/apply/session behavior through selected repo

**Files:**
- Modify: `src/app.ts`
- Modify: `src/agent/session-manager.ts`
- Modify: `src/agent/pi-runner.ts`
- Modify: `src/git/branch.ts`
- Modify: `src/git/commit.ts`
- Modify: `src/git/pr.ts`
- Modify: `src/github/token-refresh.ts`
- Test: `tests/integration/webhook.test.ts`

**Step 1: Write the failing test**
Add assertions that apply flow methods receive selected repo context (`repoName`, `repoPath`) in config arguments.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: FAIL because current flow still uses global singleton repo.

**Step 3: Write minimal implementation**
- Build repo-scoped config per request.
- Update Pi session keys to include repo name.
- Ensure git/PR/token logic uses selected repo metadata.

**Step 4: Run tests to verify it passes**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: PASS.

### Task 5: Update startup Telegram menu command descriptions

**Files:**
- Modify: `src/main.ts`

**Step 1: Write the failing test**
Leverage integration behavior (optional) or manual validation in startup logs.

**Step 2: Run check**
Run: `npm run build`
Expected: compile success.

**Step 3: Write minimal implementation**
Add `/repo` command to `setMyCommands` and include supported repo names in description (truncated if needed).

**Step 4: Verify**
Run: `npm run build && npm test`
Expected: all tests pass.

### Task 6: Update documentation

**Files:**
- Modify: `README.md`

**Step 1: Update env docs**
Replace single-repo env variables with new multi-repo env model.

**Step 2: Verify docs consistency**
Run: `rg "REPO_PATH|REPO_NAME" README.md src`
Expected: no stale runtime single-repo requirements left.

### Task 7: Final verification

**Files:**
- Verify only

**Step 1: Run full checks**
Run: `npm run check`
Expected: logging policy, build, and tests pass.

**Step 2: Summarize**
Document changed files and user-visible behavior updates.
