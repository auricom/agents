import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";
import { SuperpowersSkillsSync } from "../../src/skills/superpowers-sync.js";

describe("SuperpowersSkillsSync", () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it("clones when the target repo is missing", async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const ensureDir = vi.fn().mockResolvedValue(undefined);
    const pathExists = vi.fn().mockResolvedValue(false);

    const sync = new SuperpowersSkillsSync({
      targetDir: "/tmp/.pi/agent/skills",
      syncIntervalMs: 60_000,
      exec,
      ensureDir,
      pathExists,
      now: () => 1_700_000_000_000,
    });

    await sync.start();
    sync.stop();

    expect(ensureDir).toHaveBeenCalledWith("/tmp/.pi/agent");
    expect(exec).toHaveBeenCalledWith("git", [
      "clone",
      "--depth",
      "1",
      "https://github.com/obra/superpowers.git",
      "/tmp/.pi/agent/skills",
    ]);

    const metrics = await renderMetrics();
    expect(metrics).toContain("superpowers_skills_fetch_success_total 1");
    expect(metrics).toContain("superpowers_skills_fetch_failure_total 0");
    expect(metrics).toContain("superpowers_skills_fetch_last_status 1");
  });

  it("tracks failures when git fetch fails", async () => {
    const exec = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "network fail" });
    const sync = new SuperpowersSkillsSync({
      targetDir: "/tmp/.pi/agent/skills",
      syncIntervalMs: 60_000,
      exec,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn().mockResolvedValue(true),
      now: () => 1_700_000_000_000,
    });

    await sync.start();
    sync.stop();

    const metrics = await renderMetrics();
    expect(metrics).toContain("superpowers_skills_fetch_success_total 0");
    expect(metrics).toContain("superpowers_skills_fetch_failure_total 1");
    expect(metrics).toContain("superpowers_skills_fetch_last_status 0");
  });
});
