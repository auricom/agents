# Prometheus Core App Metrics Design

## Summary
Implement Prometheus metrics using `prom-client` for **main app routes only** (`/telegram/webhook/:token`, `/healthz`, `/readyz`), while keeping a **separate metrics server** that exposes `/metrics`.

## Goals
- Add standard HTTP request metrics for the main application server.
- Use **templated route labels** (never raw URL paths).
- Keep metrics scraping isolated on the existing secondary server.
- Preserve existing superpowers sync metrics and expose everything through a single Prometheus registry output.

## Non-goals
- No metrics for the metrics server itself.
- No high-cardinality labels (raw URL, query params, request IDs, chat IDs, tokens).
- No behavior changes in Telegram command handling.

## Chosen Approach
Adopt `prom-client` for all runtime metrics.

### Why
- Standard Prometheus primitives (Counter/Histogram/Gauge).
- Safer and less error-prone than hand-rolled exposition format.
- Easier long-term extension for workflow/business metrics later.

## Architecture

### Components
1. **Metrics registry module**
   - Owns a `prom-client` `Registry`.
   - Registers all HTTP metrics and superpowers sync metrics.

2. **HTTP metrics middleware (main app only)**
   - Added to `src/app.ts`.
   - Records request counters and latency histogram on `res.finish`.

3. **Superpowers metrics migration**
   - Replace string-based metric rendering with `prom-client` counters/gauges.
   - Keep same semantic metric names where possible.

4. **Metrics endpoint (separate server)**
   - Keep existing separate metrics Express app in `src/main.ts`.
   - `/metrics` returns `await registry.metrics()`.

## Metric Definitions

### HTTP
- `http_requests_total` (Counter)
  - Labels: `method`, `route`, `status_code`

- `http_request_duration_seconds` (Histogram)
  - Labels: `method`, `route`, `status_code`
  - Buckets: tuned for webhook latency (e.g. `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`)

### Superpowers sync (migrated)
- `superpowers_skills_fetch_success_total` (Counter)
- `superpowers_skills_fetch_failure_total` (Counter)
- `superpowers_skills_fetch_last_success_timestamp_seconds` (Gauge)
- `superpowers_skills_fetch_last_failure_timestamp_seconds` (Gauge)
- `superpowers_skills_fetch_last_attempt_timestamp_seconds` (Gauge)
- `superpowers_skills_fetch_last_duration_seconds` (Gauge)
- `superpowers_skills_fetch_last_status` (Gauge; `1` success, `0` failure)

## Route Labeling Rules
- Use templated route path (e.g. `/telegram/webhook/:token`) from Express route metadata.
- If unavailable (404 or early failure), use bounded fallback label `unmatched`.
- Never use `req.originalUrl` or full path in labels.

## Data Flow
1. Request enters main app.
2. Middleware captures start time.
3. On `res.finish`, middleware resolves route label and observes metrics.
4. Metrics server `/metrics` exposes full registry content for scraping.

## Error Handling
- Metrics collection failures must never fail request handling.
- On metric observation errors, log warning/debug and continue.
- Ensure webhook 403/500 responses still emit metric points.

## Testing Strategy

### Unit tests
- Middleware increments `http_requests_total` with expected labels.
- Histogram receives observations with expected labels.
- Route uses templated path, not raw URL.
- Fallback route label becomes `unmatched`.

### Integration tests
- Call `/healthz` and `/readyz` then verify `/metrics` includes expected HTTP series.
- Call webhook path and verify route label is `/telegram/webhook/:token`.
- Verify superpowers metrics still appear in `/metrics` output.

### Regression
- Run full checks (`npm run check`) to ensure no webhook behavior regressions.

## Operational Notes
- Keep separate metrics server for isolation/security and cleaner operational boundaries.
- Ensure Prometheus job scrapes only metrics port/path.
