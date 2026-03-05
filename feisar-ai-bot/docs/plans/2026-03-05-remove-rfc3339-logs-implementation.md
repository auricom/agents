# Remove RFC3339 From Runtime Logs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove app-emitted RFC3339 timestamps from runtime log lines and align policy/docs with Kubernetes-native timestamping.

**Architecture:** Keep structured key/value logging, log levels, and redaction unchanged while removing only the `time=` field from logger output. Update policy/documentation text so checks and operator guidance match runtime behavior.

**Tech Stack:** TypeScript, Node.js, Vitest, markdown docs.

---

### Task 1: Add failing logger format test

**Files:**
- Create: `tests/unit/logger.test.ts`
- Modify: `src/utils/logger.ts`

**Step 1: Write failing test**
- Assert emitted line contains `level=` and `msg=`
- Assert emitted line does not contain `time=`

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/unit/logger.test.ts`
Expected: FAIL because current logger includes `time=`.

**Step 3: Minimal implementation**
- Remove timestamp field from formatted base log fields.

**Step 4: Re-run test**
Run: `npm test -- tests/unit/logger.test.ts`
Expected: PASS.

### Task 2: Update policy and docs

**Files:**
- Modify: `README.md`
- Modify: `../AGENTS.md`
- Modify: `docs/logging-standard.md`

**Step 1: Update policy text**
- Remove RFC3339 requirement
- Clarify Kubernetes/platform adds timestamps.

**Step 2: Update README logging section**
- Remove RFC3339 sample language.
- Keep format examples without `time=`.

### Task 3: Verify

**Files:**
- Verify only

**Step 1: Run checks**
- `npm run build`
- `npm test -- tests/unit/logger.test.ts tests/unit/*.test.ts`
- `npm run check:logging`

**Step 2: Summarize changed behavior**
- Confirm no app-generated `time=` field remains.
