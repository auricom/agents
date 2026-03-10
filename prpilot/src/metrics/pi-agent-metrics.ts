import { Counter, Gauge, Histogram } from "prom-client";
import type { RunMode } from "../types.js";
import { metricsRegistry } from "./registry.js";

export type PiRunResult = "success" | "error" | "busy" | "empty-output" | "aborted";
type SessionMode = "rw" | "ro";

type SessionGetCache = "hit" | "miss";
type SessionAbortResult = "aborted" | "no-active";
type SessionIndexOp = "read" | "write";
export type BrainstormToggleState = "on" | "off";
export type BrainstormSkillSource = "repo" | "global" | "built-in";
export type BrainstormPromptInjectionResult = "injected" | "skipped";

const piRunsTotal = getOrCreateCounter("pi_runs_total", "Total Pi agent runs", ["mode", "result"]);
const piRunDurationSeconds = getOrCreateHistogram(
  "pi_run_duration_seconds",
  "Duration of Pi agent runs in seconds",
  ["mode", "result"],
  [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
);
const piSessionGetTotal = getOrCreateCounter("pi_session_get_total", "Total Pi session get attempts", [
  "mode",
  "cache",
]);
const piSessionAbortTotal = getOrCreateCounter("pi_session_abort_total", "Total Pi session abort attempts", ["result"]);
const piSessionsActive = getOrCreateGauge("pi_sessions_active", "Current number of in-memory Pi sessions");
const piSessionIndexIoErrorsTotal = getOrCreateCounter(
  "pi_session_index_io_errors_total",
  "Total Pi session index IO errors",
  ["op"],
);
const piAgentsMdLoadFailuresTotal = getOrCreateCounter(
  "pi_agents_md_load_failures_total",
  "Total failures loading AGENTS.md for Pi runs",
);
const brainstormToggleTotal = getOrCreateCounter(
  "prpilot_brainstorm_toggle_total",
  "Total brainstorming toggle commands",
  ["state"],
);
const brainstormTasksTotal = getOrCreateCounter(
  "prpilot_brainstorm_tasks_total",
  "Total brainstorm-enabled tasks created",
  ["source"],
);
const brainstormPromptInjectionTotal = getOrCreateCounter(
  "prpilot_brainstorm_prompt_injection_total",
  "Total brainstorming prompt injection decisions",
  ["result"],
);

export function recordPiRun(mode: RunMode, result: PiRunResult, durationSeconds: number): void {
  piRunsTotal.inc({ mode, result });
  piRunDurationSeconds.observe({ mode, result }, durationSeconds);
}

export function recordPiSessionGet(mode: SessionMode, cache: SessionGetCache): void {
  piSessionGetTotal.inc({ mode, cache });
}

export function setPiSessionsActive(count: number): void {
  piSessionsActive.set(count);
}

export function recordPiSessionAbort(result: SessionAbortResult): void {
  piSessionAbortTotal.inc({ result });
}

export function recordPiSessionIndexIoError(op: SessionIndexOp): void {
  piSessionIndexIoErrorsTotal.inc({ op });
}

export function recordPiAgentsMdLoadFailure(): void {
  piAgentsMdLoadFailuresTotal.inc();
}

export function recordBrainstormToggle(state: BrainstormToggleState): void {
  brainstormToggleTotal.inc({ state });
}

export function recordBrainstormTaskCreated(source: BrainstormSkillSource): void {
  brainstormTasksTotal.inc({ source });
}

export function recordBrainstormPromptInjection(result: BrainstormPromptInjectionResult): void {
  brainstormPromptInjectionTotal.inc({ result });
}

function getOrCreateCounter(name: string, help: string, labelNames: string[] = []): Counter<string> {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) return existing as Counter<string>;
  return new Counter({ name, help, labelNames, registers: [metricsRegistry] });
}

function getOrCreateGauge(name: string, help: string): Gauge<string> {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) return existing as Gauge<string>;
  return new Gauge({ name, help, registers: [metricsRegistry] });
}

function getOrCreateHistogram(
  name: string,
  help: string,
  labelNames: string[],
  buckets: number[],
): Histogram<string> {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) return existing as Histogram<string>;
  return new Histogram({ name, help, labelNames, buckets, registers: [metricsRegistry] });
}
