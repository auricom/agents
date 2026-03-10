import { beforeEach, describe, expect, it } from "vitest";
import {
  recordBrainstormPromptInjection,
  recordBrainstormTaskCreated,
  recordBrainstormToggle,
} from "../../src/metrics/pi-agent-metrics.js";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";

describe("brainstorm metrics", () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it("records brainstorm toggle counts by state", async () => {
    recordBrainstormToggle("on");
    recordBrainstormToggle("off");

    const metrics = await renderMetrics();
    expect(metrics).toContain('prpilot_brainstorm_toggle_total{state="on"} 1');
    expect(metrics).toContain('prpilot_brainstorm_toggle_total{state="off"} 1');
  });

  it("records brainstorm-enabled task creation by source", async () => {
    recordBrainstormTaskCreated("repo");
    recordBrainstormTaskCreated("global");
    recordBrainstormTaskCreated("built-in");

    const metrics = await renderMetrics();
    expect(metrics).toContain('prpilot_brainstorm_tasks_total{source="repo"} 1');
    expect(metrics).toContain('prpilot_brainstorm_tasks_total{source="global"} 1');
    expect(metrics).toContain('prpilot_brainstorm_tasks_total{source="built-in"} 1');
  });

  it("records brainstorm prompt injection results", async () => {
    recordBrainstormPromptInjection("injected");
    recordBrainstormPromptInjection("skipped");

    const metrics = await renderMetrics();
    expect(metrics).toContain('prpilot_brainstorm_prompt_injection_total{result="injected"} 1');
    expect(metrics).toContain('prpilot_brainstorm_prompt_injection_total{result="skipped"} 1');
  });
});
