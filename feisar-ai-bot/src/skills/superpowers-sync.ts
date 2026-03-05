import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execCommand, type ExecResult } from "../utils/exec.js";
import { logger } from "../utils/logger.js";

const SUPERPOWERS_REPO_URL = "https://github.com/obra/superpowers.git";
const DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface SyncMetrics {
  successfulFetches: number;
  failedFetches: number;
  lastSuccessTimestampSeconds: number;
  lastFailureTimestampSeconds: number;
  lastAttemptTimestampSeconds: number;
  lastDurationSeconds: number;
  lastFetchStatus: 0 | 1;
}

interface SuperpowersSkillsSyncOptions {
  targetDir?: string;
  syncIntervalMs?: number;
  exec?: (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ) => Promise<ExecResult>;
  ensureDir?: (targetPath: string) => Promise<void>;
  pathExists?: (targetPath: string) => Promise<boolean>;
  now?: () => number;
}

export class SuperpowersSkillsSync {
  private readonly targetDir: string;
  private readonly syncIntervalMs: number;
  private readonly exec: NonNullable<SuperpowersSkillsSyncOptions["exec"]>;
  private readonly ensureDir: NonNullable<SuperpowersSkillsSyncOptions["ensureDir"]>;
  private readonly pathExists: NonNullable<SuperpowersSkillsSyncOptions["pathExists"]>;
  private readonly now: NonNullable<SuperpowersSkillsSyncOptions["now"]>;

  private syncTimer: NodeJS.Timeout | null = null;
  private syncRunning = false;

  private readonly metrics: SyncMetrics = {
    successfulFetches: 0,
    failedFetches: 0,
    lastSuccessTimestampSeconds: 0,
    lastFailureTimestampSeconds: 0,
    lastAttemptTimestampSeconds: 0,
    lastDurationSeconds: 0,
    lastFetchStatus: 0,
  };

  constructor(options: SuperpowersSkillsSyncOptions = {}) {
    this.targetDir = options.targetDir ?? path.join(os.homedir(), ".pi", "agent", "skills");
    this.syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
    this.exec = options.exec ?? execCommand;
    this.ensureDir = options.ensureDir ?? (async (targetPath) => {
      await fs.mkdir(targetPath, { recursive: true });
    });
    this.pathExists = options.pathExists ?? defaultPathExists;
    this.now = options.now ?? (() => Date.now());
  }

  async start(): Promise<void> {
    logger.info("superpowers sync service starting", {
      targetDir: this.targetDir,
      syncIntervalMs: this.syncIntervalMs,
    });

    await this.runSync("startup");

    this.syncTimer = setInterval(() => {
      void this.runSync("schedule");
    }, this.syncIntervalMs);

    if (typeof this.syncTimer.unref === "function") {
      this.syncTimer.unref();
    }
  }

  stop(): void {
    if (!this.syncTimer) return;
    clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  renderPrometheusMetrics(): string {
    return [
      "# HELP superpowers_skills_fetch_success_total Total successful fetch attempts for superpowers skills",
      "# TYPE superpowers_skills_fetch_success_total counter",
      `superpowers_skills_fetch_success_total ${this.metrics.successfulFetches}`,
      "# HELP superpowers_skills_fetch_failure_total Total failed fetch attempts for superpowers skills",
      "# TYPE superpowers_skills_fetch_failure_total counter",
      `superpowers_skills_fetch_failure_total ${this.metrics.failedFetches}`,
      "# HELP superpowers_skills_fetch_last_success_timestamp_seconds Last successful fetch attempt timestamp",
      "# TYPE superpowers_skills_fetch_last_success_timestamp_seconds gauge",
      `superpowers_skills_fetch_last_success_timestamp_seconds ${this.metrics.lastSuccessTimestampSeconds}`,
      "# HELP superpowers_skills_fetch_last_failure_timestamp_seconds Last failed fetch attempt timestamp",
      "# TYPE superpowers_skills_fetch_last_failure_timestamp_seconds gauge",
      `superpowers_skills_fetch_last_failure_timestamp_seconds ${this.metrics.lastFailureTimestampSeconds}`,
      "# HELP superpowers_skills_fetch_last_attempt_timestamp_seconds Last fetch attempt timestamp",
      "# TYPE superpowers_skills_fetch_last_attempt_timestamp_seconds gauge",
      `superpowers_skills_fetch_last_attempt_timestamp_seconds ${this.metrics.lastAttemptTimestampSeconds}`,
      "# HELP superpowers_skills_fetch_last_duration_seconds Duration of last fetch attempt",
      "# TYPE superpowers_skills_fetch_last_duration_seconds gauge",
      `superpowers_skills_fetch_last_duration_seconds ${this.metrics.lastDurationSeconds}`,
      "# HELP superpowers_skills_fetch_last_status Last fetch status (1=success, 0=failure)",
      "# TYPE superpowers_skills_fetch_last_status gauge",
      `superpowers_skills_fetch_last_status ${this.metrics.lastFetchStatus}`,
      "",
    ].join("\n");
  }

  private async runSync(trigger: "startup" | "schedule"): Promise<void> {
    if (this.syncRunning) {
      logger.warn("superpowers sync skipped; previous run still in progress", { trigger });
      return;
    }

    this.syncRunning = true;
    const startedAt = this.now();
    this.metrics.lastAttemptTimestampSeconds = Math.floor(startedAt / 1000);

    try {
      await this.syncOnce();
      const successAt = Math.floor(this.now() / 1000);
      this.metrics.successfulFetches += 1;
      this.metrics.lastSuccessTimestampSeconds = successAt;
      this.metrics.lastFetchStatus = 1;
      logger.info("superpowers skills fetch successful", {
        trigger,
        targetDir: this.targetDir,
      });
    } catch (error) {
      const failureAt = Math.floor(this.now() / 1000);
      this.metrics.failedFetches += 1;
      this.metrics.lastFailureTimestampSeconds = failureAt;
      this.metrics.lastFetchStatus = 0;
      logger.error("superpowers skills fetch failed", {
        trigger,
        targetDir: this.targetDir,
        error: (error as Error).message,
      });
    } finally {
      const duration = (this.now() - startedAt) / 1000;
      this.metrics.lastDurationSeconds = Number(duration.toFixed(3));
      this.syncRunning = false;
    }
  }

  private async syncOnce(): Promise<void> {
    const parentDir = path.dirname(this.targetDir);
    await this.ensureDir(parentDir);

    const gitMetadataPath = path.join(this.targetDir, ".git");
    const hasRepo = await this.pathExists(gitMetadataPath);

    if (!hasRepo) {
      logger.debug("superpowers skills repo not found; cloning", {
        targetDir: this.targetDir,
        repo: SUPERPOWERS_REPO_URL,
      });
      const cloneResult = await this.exec("git", ["clone", "--depth", "1", SUPERPOWERS_REPO_URL, this.targetDir]);
      if (cloneResult.code !== 0) {
        throw new Error(`git clone failed (${cloneResult.code}): ${cloneResult.stderr || cloneResult.stdout}`);
      }
      return;
    }

    logger.debug("superpowers skills repo found; fetching latest", {
      targetDir: this.targetDir,
    });

    const fetchResult = await this.exec("git", ["-C", this.targetDir, "fetch", "origin", "main", "--depth", "1"]);
    if (fetchResult.code !== 0) {
      throw new Error(`git fetch failed (${fetchResult.code}): ${fetchResult.stderr || fetchResult.stdout}`);
    }

    const resetResult = await this.exec("git", ["-C", this.targetDir, "reset", "--hard", "origin/main"]);
    if (resetResult.code !== 0) {
      throw new Error(`git reset failed (${resetResult.code}): ${resetResult.stderr || resetResult.stdout}`);
    }

    const cleanResult = await this.exec("git", ["-C", this.targetDir, "clean", "-fd"]);
    if (cleanResult.code !== 0) {
      throw new Error(`git clean failed (${cleanResult.code}): ${cleanResult.stderr || cleanResult.stdout}`);
    }
  }
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
