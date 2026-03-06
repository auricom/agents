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

  it("fetches/reset/clean when repo already exists", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

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

    expect(exec).toHaveBeenNthCalledWith(1, "git", ["-C", "/tmp/.pi/agent/skills", "fetch", "origin", "main", "--depth", "1"]);
    expect(exec).toHaveBeenNthCalledWith(2, "git", ["-C", "/tmp/.pi/agent/skills", "reset", "--hard", "origin/main"]);
    expect(exec).toHaveBeenNthCalledWith(3, "git", ["-C", "/tmp/.pi/agent/skills", "clean", "-fd"]);
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

  it("tracks failures when reset or clean fail", async () => {
    const resetFailExec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "reset fail" });

    const resetFailSync = new SuperpowersSkillsSync({
      targetDir: "/tmp/.pi/agent/skills",
      syncIntervalMs: 60_000,
      exec: resetFailExec,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn().mockResolvedValue(true),
      now: () => 1_700_000_000_000,
    });
    await resetFailSync.start();
    resetFailSync.stop();

    const cleanFailExec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "clean fail" });

    const cleanFailSync = new SuperpowersSkillsSync({
      targetDir: "/tmp/.pi/agent/skills",
      syncIntervalMs: 60_000,
      exec: cleanFailExec,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn().mockResolvedValue(true),
      now: () => 1_700_000_000_000,
    });
    await cleanFailSync.start();
    cleanFailSync.stop();

    const metrics = await renderMetrics();
    expect(metrics).toContain("superpowers_skills_fetch_failure_total 2");
  });

  it("skips overlapping sync runs and allows stop without active timer", async () => {
    const exec = vi.fn();
    const sync = new SuperpowersSkillsSync({
      targetDir: "/tmp/.pi/agent/skills",
      syncIntervalMs: 60_000,
      exec,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn().mockResolvedValue(true),
      now: () => 1_700_000_000_000,
    });

    sync.stop();
    (sync as any).syncRunning = true;
    await (sync as any).runSync("schedule");

    expect(exec).not.toHaveBeenCalled();
  });
});
