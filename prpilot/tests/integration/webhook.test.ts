import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type TelegramClient } from "../../src/app.js";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";
import type { AppConfig } from "../../src/types.js";

let updateIdSeq = 1000;

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8080,
    publicBaseUrl: "https://example.com",
    telegramBotToken: "bot-token",
    telegramWebhookSecret: "secret-token",
    telegramAllowedUserId: 42,
    logLevel: "ERROR",
    repoOwner: "owner",
    reposRoot: "/tmp",
    repoNames: ["repo-one", "repo-two"],
    repoBaseBranch: "main",
    githubAppId: "123",
    githubAppPrivateKeyPem: "pem",
    githubAppPrivateKeyPath: undefined,
    githubAppInstallationId: undefined,
    sessionDir: path.join(os.tmpdir(), `prpilot-test-${process.pid}-${Math.random().toString(16).slice(2)}`),
    isDev: true,
    ...overrides,
  };
}

function makeUpdate(text: string, userId = 42, chatId = 99): object {
  updateIdSeq += 1;
  return {
    update_id: updateIdSeq,
    message: {
      text,
      from: { id: userId },
      chat: { id: chatId },
    },
  };
}

function mockTelegram(): TelegramClient {
  return {
    sendMessage: vi.fn(async () => {}),
    sendChatAction: vi.fn(async () => {}),
    setWebhook: vi.fn(async () => {}),
    getWebhookInfo: vi.fn(async () => ({})),
    setMyCommands: vi.fn(async () => {}),
    deleteMyCommands: vi.fn(async () => {}),
  };
}

function makeApplyReadyDeps(telegram: TelegramClient, execCommandImpl: (args: string[]) => { code: number; stdout: string; stderr: string }) {
  return {
    telegram,
    piRunner: {
      run: vi.fn(async () => "run output"),
      getLastChatSummary: vi.fn(async () => null),
    },
    sessionManager: { abort: vi.fn(async () => false) },
    tokenProvider: {
      getToken: vi.fn(async () => "token"),
      forceRefresh: vi.fn(async () => "token-2"),
    },
    createFeatureBranch: vi.fn(async () => "agent/branch"),
    commitAll: vi.fn(async () => ({ changed: true, summary: "summary" })),
    pushBranch: vi.fn(async () => {}),
    createPullRequest: vi.fn(async () => "https://github.com/owner/repo/pull/1"),
    execCommand: vi.fn(async (_command: string, args: string[]) => execCommandImpl(args)),
  };
}

async function waitForTaskHistoryEntry(sessionDir: string, needle: string): Promise<void> {
  const filePath = path.join(sessionDir, "task-history.json");
  const timeoutMs = 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      if (raw.includes(needle)) return;
    } catch {
      // wait for first write
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for task history entry: ${needle}`);
}

describe("telegram webhook integration", () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it("rejects invalid route token", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    const response = await request(app)
      .post("/telegram/webhook/wrong")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ ok: false });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects invalid header secret", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "wrong")
      .send(makeUpdate("/status"));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ ok: false });
  });

  it("sends unauthorized response for unknown user", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status", 7));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      "⛔ <b>Unauthorized</b>\nThis bot is restricted to approved users.",
      "HTML",
    );
  });

  it("handles /status", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), {
      telegram,
      currentBranch: vi.fn(async () => "main"),
    });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      "🩺 <b>Status</b>\n✅ <b>Health</b>: healthy\n📦 <b>Repo</b>: none (use <code>/repo &lt;name&gt;</code>; supported: repo-one, repo-two)\n📁 <b>Branch</b>: <code>none</code>\n🧭 <b>Task</b>: none",
      "HTML",
    );
  });

  it("blocks chat when repository is not selected", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), {
      telegram,
      piRunner: { run: vi.fn(async () => "Plan output"), getLastChatSummary: vi.fn(async () => null) },
    });

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("deploy seasonpackerr"));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      "❓ <b>Select Repository First</b>\nUse <code>/repo &lt;name&gt;</code>\nSupported: <code>repo-one, repo-two</code>",
      "HTML",
    );
  });

  it("shows recent tasks via /tasks", async () => {
    const telegram = mockTelegram();
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const { app } = createApp(testConfig(), {
      telegram,
      piRunner: { run: vi.fn(async () => "Plan output"), getLastChatSummary: vi.fn(async () => null) },
      currentBranch: vi.fn(async () => "main"),
      execCommand,
    });

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("📦 <b>Repo</b>: <code>repo-one</code>"),
      "HTML",
    );

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("deploy seasonpackerr"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));

    expect(response.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("🗂️ <b>Tasks</b>"),
      "HTML",
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("deploy seasonpackerr"),
      "HTML",
    );
  });

  it("stops apply when no commits are ahead of base", async () => {
    const telegram = mockTelegram();
    const deps = makeApplyReadyDeps(telegram, (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "rev-list") return { code: 0, stdout: "0\n", stderr: "" };
      if (args[0] === "ls-remote") return { code: 0, stdout: "abc\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const { app } = createApp(testConfig(), deps);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/apply add tests"));

    expect(response.status).toBe(200);
    expect(deps.commitAll).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: "owner", repoName: "repo-one", repoPath: "/tmp/repo-one" }),
      "agent/branch",
      expect.stringContaining("add tests"),
      "token",
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("No commits ahead of main; refusing to create PR."),
      "HTML",
    );
  });

  it("stops apply when remote branch is missing after push", async () => {
    const telegram = mockTelegram();
    const deps = makeApplyReadyDeps(telegram, (args) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
      if (args[0] === "ls-remote") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const { app } = createApp(testConfig(), deps);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    const response = await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/apply add tests"));

    expect(response.status).toBe(200);
    expect(deps.commitAll).toHaveBeenCalledWith(
      expect.objectContaining({ repoOwner: "owner", repoName: "repo-one", repoPath: "/tmp/repo-one" }),
      "agent/branch",
      expect.stringContaining("add tests"),
      "token",
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Remote branch agent/branch not found after push; refusing to create PR."),
      "HTML",
    );
  });

  it("persists selected repository across app restart", async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-"));
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const firstTelegram = mockTelegram();
    const firstApp = createApp(testConfig({ sessionDir }), {
      telegram: firstTelegram,
      execCommand,
    });

    const selectResponse = await request(firstApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-two"));

    expect(selectResponse.status).toBe(200);
    expect(firstTelegram.sendMessage).toHaveBeenCalledWith(
      99,
      "✅ <b>Repository Selected</b>\n<code>repo-two</code>",
      "HTML",
    );

    const secondTelegram = mockTelegram();
    const secondApp = createApp(testConfig({ sessionDir }), {
      telegram: secondTelegram,
      currentBranch: vi.fn(async () => "main"),
    });

    const statusResponse = await request(secondApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"));

    expect(statusResponse.status).toBe(200);
    expect(secondTelegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("📦 <b>Repo</b>: <code>repo-two</code>"),
      "HTML",
    );
  });

  it("persists tasks history across app restart and keeps latest entries", async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "prpilot-tasks-"));
    const execCommand = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const firstTelegram = mockTelegram();
    const firstApp = createApp(testConfig({ sessionDir }), {
      telegram: firstTelegram,
      execCommand,
      piRunner: { run: vi.fn(async () => "Plan output"), getLastChatSummary: vi.fn(async () => null) },
    });

    await request(firstApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/repo repo-one"));

    await request(firstApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("deploy app one"));

    await waitForTaskHistoryEntry(sessionDir, "deploy app one");

    const secondTelegram = mockTelegram();
    const secondApp = createApp(testConfig({ sessionDir }), {
      telegram: secondTelegram,
      currentBranch: vi.fn(async () => "main"),
    });

    const response = await request(secondApp.app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/tasks"));

    expect(response.status).toBe(200);
    expect(secondTelegram.sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("deploy app one"),
      "HTML",
    );
  });

  it("records main app http metrics with templated route labels", async () => {
    const telegram = mockTelegram();
    const { app } = createApp(testConfig(), { telegram });

    await request(app).get("/healthz").expect(200);

    await request(app)
      .post("/telegram/webhook/secret-token")
      .set("X-Telegram-Bot-Api-Secret-Token", "secret-token")
      .send(makeUpdate("/status"))
      .expect(200);

    const metrics = await renderMetrics();
    expect(metrics).toContain('http_requests_total{method="GET",route="/healthz",status_code="200"} 1');
    expect(metrics).toContain('http_requests_total{method="POST",route="/telegram/webhook/:token",status_code="200"} 1');
    expect(metrics).toContain('http_request_duration_seconds_count{method="GET",route="/healthz",status_code="200"} 1');
  });
});
