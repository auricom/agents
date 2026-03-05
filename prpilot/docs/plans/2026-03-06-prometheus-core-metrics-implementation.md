# Prometheus Core Metrics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement `prom-client`-based Prometheus metrics for main app routes with templated route labels and expose them via the existing separate metrics server.

**Architecture:** Introduce a shared Prometheus registry and HTTP metrics middleware for the main Express app only. Migrate superpowers sync metrics to `prom-client` and expose all metrics from one registry on the existing `/metrics` endpoint in the secondary metrics server.

**Tech Stack:** TypeScript, Express, prom-client, Vitest, Supertest.

---

### Task 1: Add Prometheus dependency and shared registry scaffolding

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/metrics/registry.ts`

**Step 1: Write the failing test**
Add a new unit test file `tests/unit/http-metrics.test.ts` importing registry helpers that do not exist yet.

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/unit/http-metrics.test.ts`
Expected: FAIL with module import/not found errors.

**Step 3: Write minimal implementation**
- Add `prom-client` dependency.
- Add `src/metrics/registry.ts` exporting a singleton registry and helper for content type/metrics text.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/unit/http-metrics.test.ts`
Expected: test file loads (still failing later assertions, import errors gone).

**Step 5: Commit**
```bash
git add package.json package-lock.json src/metrics/registry.ts tests/unit/http-metrics.test.ts
git commit -m "chore(metrics): add prom-client registry scaffold"
```

### Task 2: Implement HTTP request metrics middleware (main app only)

**Files:**
- Create: `src/metrics/http-metrics.ts`
- Modify: `src/app.ts`
- Test: `tests/unit/http-metrics.test.ts`

**Step 1: Write the failing test**
In `tests/unit/http-metrics.test.ts`, add tests asserting:
- increments `http_requests_total` for `GET /healthz` with `route="/healthz"`, `status_code="200"`
- records `http_request_duration_seconds` series
- uses `route="unmatched"` for unknown route
- does not use raw URL with webhook secret

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/unit/http-metrics.test.ts`
Expected: FAIL due to missing middleware/metrics labels.

**Step 3: Write minimal implementation**
- Build middleware that starts timer and observes on `res.finish`.
- Resolve route template path from Express metadata; fallback to `unmatched`.
- Register counter + histogram with labels: `method`, `route`, `status_code`.
- Wire middleware in `src/app.ts` before route registration.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/unit/http-metrics.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/metrics/http-metrics.ts src/app.ts tests/unit/http-metrics.test.ts
git commit -m "feat(metrics): add http request counter and latency histogram"
```

### Task 3: Migrate superpowers metrics to prom-client

**Files:**
- Modify: `src/skills/superpowers-sync.ts`
- Test: `tests/unit/superpowers-sync.test.ts`

**Step 1: Write the failing test**
Update tests to stop relying on `renderPrometheusMetrics()` and instead assert prom-client registry output still includes:
- `superpowers_skills_fetch_success_total`
- `superpowers_skills_fetch_failure_total`
- `superpowers_skills_fetch_last_status`

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/unit/superpowers-sync.test.ts`
Expected: FAIL due to outdated API expectations.

**Step 3: Write minimal implementation**
- Replace local metrics struct rendering with `Counter`/`Gauge` updates in sync lifecycle.
- Keep metric names and semantics unchanged.
- Remove/replace `renderPrometheusMetrics()` with registry-based exposure path.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/unit/superpowers-sync.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/skills/superpowers-sync.ts tests/unit/superpowers-sync.test.ts
git commit -m "refactor(metrics): migrate superpowers sync metrics to prom-client"
```

### Task 4: Expose registry metrics on existing metrics server

**Files:**
- Modify: `src/main.ts`
- Modify: `README.md`
- Test: `tests/integration/webhook.test.ts`

**Step 1: Write the failing test**
Add integration assertions that after main-app requests, metrics output includes:
- `http_requests_total{method="GET",route="/healthz",status_code="200"}`
- `http_request_duration_seconds_bucket{...route="/healthz"...}`
- webhook route label `route="/telegram/webhook/:token"`

**Step 2: Run test to verify it fails**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: FAIL because current setup does not expose new HTTP metrics via shared registry.

**Step 3: Write minimal implementation**
- Update `/metrics` handler in `src/main.ts` to return `prom-client` registry output.
- Ensure content type matches Prometheus exposition from registry.
- Update README metrics section to document new HTTP metric names/labels and scope.

**Step 4: Run test to verify it passes**
Run: `npm test -- tests/integration/webhook.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/main.ts README.md tests/integration/webhook.test.ts
git commit -m "feat(metrics): expose shared prom-client registry on metrics endpoint"
```

### Task 5: Final verification

**Files:**
- Verify only

**Step 1: Run full checks**
Run: `npm run check`
Expected: logging policy, TypeScript build, and tests all PASS.

**Step 2: Manual sanity check**
Run app locally and curl metrics endpoint:
```bash
npm run dev
curl -s http://localhost:${METRICS_PORT:-9090}/metrics | rg "http_requests_total|http_request_duration_seconds|superpowers_skills_fetch_last_status"
```
Expected: lines for both HTTP and superpowers metrics are present.

**Step 3: Commit verification updates (if any)**
```bash
git add -A
git commit -m "test: finalize prometheus core metrics verification" || true
```
