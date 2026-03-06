import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type Express } from "express";
import { PiRunner } from "./agent/pi-runner.js";
import { PiSessionManager } from "./agent/session-manager.js";
import { createFeatureBranch } from "./git/branch.js";
import { commitAll } from "./git/commit.js";
import { createPullRequest, pushBranch } from "./git/pr.js";
import { renderPullRequestBody } from "./git/pr-body-template.js";
import { GitHubTokenProvider } from "./github/token-refresh.js";
import { TelegramApi } from "./telegram/api.js";
import { parseCommand } from "./telegram/commands.js";
import { isAuthorizedUser, verifyWebhookSecret } from "./telegram/verify.js";
import type { AppConfig, RepoContext } from "./types.js";
import { assertSuccess, execCommand } from "./utils/exec.js";
import { logger } from "./utils/logger.js";
import { createHttpMetricsMiddleware } from "./metrics/http-metrics.js";
import { registerHealthRoutes } from "./web/health.js";

export interface TelegramClient {
  sendMessage(chatId: number, text: string, parseMode?: "HTML"): Promise<void>;
  sendChatAction(chatId: number, action?: "typing" | "upload_document"): Promise<void>;
  setWebhook(webhookUrl: string, secretToken: string): Promise<void>;
  getWebhookInfo(): Promise<unknown>;
  setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void>;
  deleteMyCommands(scope?: Record<string, unknown>): Promise<void>;
}

export interface SessionManagerLike {
  abort(chatId: number): Promise<boolean>;
}

export interface PiRunnerLike {
  run(
    chatId: number,
    mode: "chat" | "apply",
    task: string,
    repoName: string,
    repoPath: string,
  ): Promise<string>;
  getLastChatSummary(chatId: number, repoName: string, repoPath: string): Promise<string | null>;
}

export interface TokenProviderLike {
  getToken(repoName: string): Promise<string>;
  forceRefresh(repoName: string): Promise<string>;
}

type TaskStatus = "planned" | "running" | "applied" | "no-changes" | "failed" | "aborted";

interface TaskEntry {
  repoName: string;
  label: string;
  slug: string;
  mode: "chat" | "apply";
  status: TaskStatus;
  summary?: string;
  createdAt: string;
}

interface AppDeps {
  sessionManager: SessionManagerLike;
  piRunner: PiRunnerLike;
  telegram: TelegramClient;
  tokenProvider: TokenProviderLike;
  currentBranch: (repo: RepoContext) => Promise<string>;
  createFeatureBranch: typeof createFeatureBranch;
  commitAll: (repo: RepoContext, branch: string, message: string, token: string) => Promise<{ changed: boolean; summary: string }>;
  pushBranch: typeof pushBranch;
  createPullRequest: typeof createPullRequest;
  execCommand: typeof execCommand;
}

export function createApp(cfg: AppConfig, depsOverrides: Partial<AppDeps> = {}): { app: Express; telegram: TelegramClient } {
  const defaultSessionManager = new PiSessionManager(cfg);
  const sessionManager = depsOverrides.sessionManager ?? defaultSessionManager;
  const telegram = depsOverrides.telegram ?? new TelegramApi(cfg.telegramBotToken);

  const piRunner = depsOverrides.piRunner
    ?? (depsOverrides.sessionManager
      ? new PiRunner(depsOverrides.sessionManager as PiSessionManager)
      : new PiRunner(defaultSessionManager));

  const deps: AppDeps = {
    sessionManager,
    piRunner,
    telegram,
    tokenProvider: depsOverrides.tokenProvider ?? new GitHubTokenProvider(cfg),
    currentBranch: depsOverrides.currentBranch ?? ((repo) => currentBranch(repo, depsOverrides.execCommand ?? execCommand)),
    createFeatureBranch: depsOverrides.createFeatureBranch ?? createFeatureBranch,
    commitAll: depsOverrides.commitAll ?? commitAll,
    pushBranch: depsOverrides.pushBranch ?? pushBranch,
    createPullRequest: depsOverrides.createPullRequest ?? createPullRequest,
    execCommand: depsOverrides.execCommand ?? execCommand,
  };

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(createHttpMetricsMiddleware());
  registerHealthRoutes(app);

  let applyLock = false;
  let applyLockSince: number | null = null;
  const taskHistoryStorePath = path.join(cfg.sessionDir, "task-history.json");
  const taskHistory: TaskEntry[] = [];
  let currentTask: TaskEntry | null = null;
  const inFlightUpdateIds = new Set<string>();
  const recentlyProcessedUpdateIds = new Map<string, number>();
  const dedupeWindowMs = 2 * 60 * 1000;
  const selectedRepoStorePath = path.join(cfg.sessionDir, "selected-repos.json");
  const chatIntentStorePath = path.join(cfg.sessionDir, "chat-intents.json");
  const selectedRepoByChatId = new Map<number, string>();
  const lastChatIntentByChatRepo = new Map<string, string>();
  const selectedRepoLoad = loadSelectedRepos(selectedRepoStorePath, cfg.repoNames, selectedRepoByChatId);
  const chatIntentLoad = loadChatIntents(chatIntentStorePath, lastChatIntentByChatRepo);
  const taskHistoryLoad = loadTaskHistory(taskHistoryStorePath, taskHistory);

  app.post("/telegram/webhook/:token", async (req, res) => {
    const requestId = randomUUID();

    await logger.withContext({ requestId }, async () => {
      let taskHistoryDirty = false;
      let responseSent = false;
      const markTaskHistoryDirty = () => {
        taskHistoryDirty = true;
      };
      const respondOk = () => {
        if (responseSent || res.headersSent) return;
        responseSent = true;
        res.status(200).json({ ok: true });
      };
      const respondForbidden = () => {
        if (responseSent || res.headersSent) return;
        responseSent = true;
        res.status(403).json({ ok: false });
      };

      try {
        await Promise.all([selectedRepoLoad, chatIntentLoad, taskHistoryLoad]);

        const routeToken = req.params.token;
        if (routeToken !== cfg.telegramWebhookSecret) {
          logger.warn("webhook route token mismatch");
          respondForbidden();
          return;
        }

        const headerSecret = req.header("X-Telegram-Bot-Api-Secret-Token");
        if (!verifyWebhookSecret(headerSecret, cfg.telegramWebhookSecret)) {
          logger.warn("webhook header secret mismatch");
          respondForbidden();
          return;
        }

        const update = req.body as any;
        const updateId = String(update?.update_id ?? "unknown");
        const message = update?.message;
        const text = message?.text;
        const userId = message?.from?.id as number | undefined;
        const chatId = message?.chat?.id as number | undefined;
        const dedupeKey = `${chatId ?? "unknown"}:${updateId}`;
        pruneProcessedUpdates(recentlyProcessedUpdateIds, dedupeWindowMs, Date.now());

        if (inFlightUpdateIds.has(dedupeKey)) {
          logger.info("duplicate telegram update ignored (in-flight)", { updateId, chatId: chatId ?? "unknown" });
          respondOk();
          return;
        }
        const processedAt = recentlyProcessedUpdateIds.get(dedupeKey);
        if (processedAt && Date.now() - processedAt < dedupeWindowMs) {
          logger.info("duplicate telegram update ignored (recent)", { updateId, chatId: chatId ?? "unknown" });
          respondOk();
          return;
        }
        inFlightUpdateIds.add(dedupeKey);

        await logger.withContext(
          {
            updateId,
            chatId: chatId ?? "unknown",
            userId: userId ?? "unknown",
          },
          async () => {
            logger.debug("telegram webhook update received");

            if (!text || !chatId) {
              respondOk();
              return;
            }

            if (!isAuthorizedUser(userId, cfg.telegramAllowedUserId)) {
              logger.warn("unauthorized telegram user");
              await deps.telegram.sendMessage(
                chatId,
                formatTelegramMessage("⛔", "Unauthorized", [
                  "This bot is restricted to approved users.",
                ]),
                "HTML",
              );
              respondOk();
              return;
            }

            const command = parseCommand(text);
            logger.info("telegram command received", { command: command.type });

            await deps.telegram.sendChatAction(chatId).catch(() => {});
            const typingInterval = setInterval(() => {
              deps.telegram.sendChatAction(chatId).catch(() => {});
            }, 4000);

            try {
              switch (command.type) {
                case "status": {
                  const selectedRepoName = selectedRepoByChatId.get(chatId) ?? null;
                  const selectedRepo = selectedRepoName ? resolveRepoContext(cfg, selectedRepoName) : null;
                  const branch = selectedRepo ? await deps.currentBranch(selectedRepo) : "none";
                  const taskLine = currentTask
                    ? formatTelegramRow(
                      "🧭",
                      "Task",
                      `${formatCode(currentTask.slug)} - ${formatTaskStatus(currentTask.status)} - ${escapeHtml(currentTask.label)}`,
                    )
                    : formatTelegramRow("🧭", "Task", "none");
                  const repoLine = selectedRepo
                    ? formatTelegramRow("📦", "Repo", formatCode(selectedRepo.repoName))
                    : formatTelegramRow(
                      "📦",
                      "Repo",
                      `none (use ${formatCode("/repo <name>")}; supported: ${escapeHtml(formatSupportedRepos(cfg.repoNames))})`,
                    );
                  await deps.telegram.sendMessage(
                    chatId,
                    formatTelegramMessage("🩺", "Status", [
                      formatTelegramRow("✅", "Health", "healthy"),
                      repoLine,
                      formatTelegramRow("📁", "Branch", formatCode(branch)),
                      taskLine,
                    ]),
                    "HTML",
                  );
                  break;
                }

                case "tasks": {
                  const lines = taskHistory.length
                    ? taskHistory.map((entry, index) => formatTaskListLine(entry, index)).join("\n")
                    : "• No recent tasks";
                  await deps.telegram.sendMessage(chatId, formatTelegramMessage("🗂️", "Tasks", [lines]), "HTML");
                  break;
                }

                case "task": {
                  if (!command.index) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("ℹ️", "Task Details", [
                        `Usage: ${formatCode("/task <number>")}`,
                        `List tasks with ${formatCode("/tasks")}`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  const entry = taskHistory[command.index - 1];
                  if (!entry) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("❌", "Task Not Found", [
                        `No task #${command.index}.`,
                        `List tasks with ${formatCode("/tasks")}`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  await deps.telegram.sendMessage(
                    chatId,
                    formatTelegramMessage("🔎", `Task #${command.index}`, formatTaskDetailLines(entry)),
                    "HTML",
                  );
                  break;
                }

                case "repo": {
                  if (!command.name) {
                    const selectedRepo = selectedRepoByChatId.get(chatId) ?? "none";
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("📦", "Repository", [
                        `• Current: ${formatCode(selectedRepo)}`,
                        `• Supported: ${formatCode(formatSupportedRepos(cfg.repoNames))}`,
                        `Set with ${formatCode("/repo <name>")}.`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  if (!cfg.repoNames.includes(command.name)) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("❌", "Unsupported Repository", [
                        `Use one of: ${formatCode(formatSupportedRepos(cfg.repoNames))}`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  const selectedRepo = resolveRepoContext(cfg, command.name);
                  const verifyRepo = await deps.execCommand("git", ["rev-parse", "--is-inside-work-tree"], {
                    cwd: selectedRepo.repoPath,
                  });
                  if (verifyRepo.code !== 0 || !/true/i.test(verifyRepo.stdout.trim())) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("❌", "Repository Not Ready", [
                        `${formatCode(selectedRepo.repoPath)} is missing or not a git repository.`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  selectedRepoByChatId.set(chatId, selectedRepo.repoName);
                  await saveSelectedRepos(selectedRepoStorePath, selectedRepoByChatId);
                  await deps.telegram.sendMessage(
                    chatId,
                    formatTelegramMessage("✅", "Repository Selected", [
                      formatCode(selectedRepo.repoName),
                    ]),
                    "HTML",
                  );
                  break;
                }

                case "chat": {
                  const selectedRepo = requireSelectedRepo(chatId, selectedRepoByChatId, cfg);
                  if (!selectedRepo) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("❓", "Select Repository First", [
                        `Use ${formatCode("/repo <name>")}`,
                        `Supported: ${formatCode(formatSupportedRepos(cfg.repoNames))}`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  try {
                    await resetRepoToMain(selectedRepo, deps.execCommand);
                  } catch (error) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("⚠️", "Failed to Prepare Repository", [
                        formatCode((error as Error).message),
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  const entry = createTaskEntry(selectedRepo.repoName, command.text, "chat", "planned");
                  currentTask = entry;
                  addTaskHistory(taskHistory, entry);
                  markTaskHistoryDirty();
                  rememberChatIntent(lastChatIntentByChatRepo, chatId, selectedRepo.repoName, command.text);
                  await saveChatIntents(chatIntentStorePath, lastChatIntentByChatRepo);
                  logger.debug("acknowledging webhook before chat run");
                  respondOk();

                  try {
                    const output = await deps.piRunner.run(
                      chatId,
                      "chat",
                      command.text,
                      selectedRepo.repoName,
                      selectedRepo.repoPath,
                    );
                    entry.summary = summarizeTaskText(output);
                    markTaskHistoryDirty();
                    await deps.telegram.sendMessage(chatId, truncateTelegram(output), "HTML");
                  } finally {
                    try {
                      await resetRepoToMain(selectedRepo, deps.execCommand);
                    } catch (error) {
                      await deps.telegram.sendMessage(
                        chatId,
                        formatTelegramMessage("⚠️", "Failed to Restore Repository", [
                          formatCode((error as Error).message),
                        ]),
                        "HTML",
                      );
                    }
                  }
                  break;
                }

                case "apply": {
                  const selectedRepo = requireSelectedRepo(chatId, selectedRepoByChatId, cfg);
                  if (!selectedRepo) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("❓", "Select Repository First", [
                        `Use ${formatCode("/repo <name>")}`,
                        `Supported: ${formatCode(formatSupportedRepos(cfg.repoNames))}`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  if (applyLock) {
                    const now = Date.now();
                    const startedAt = applyLockSince ?? now;
                    const remainingMs = Math.max(0, 5 * 60 * 1000 - (now - startedAt));
                    const waitMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("⏳", "Apply Busy", [
                        `Another ${formatCode("/apply")} is already running.`,
                        `Retry in about ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}.`,
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  try {
                    await resetRepoToMain(selectedRepo, deps.execCommand);
                  } catch (error) {
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("⚠️", "Failed to Prepare Repository", [
                        formatCode((error as Error).message),
                      ]),
                      "HTML",
                    );
                    break;
                  }

                  let applyPrompt: string;
                  let applyLabel: string;
                  let summarySource: string | null = null;

                  if (command.task) {
                    applyLabel = command.task;
                    summarySource = command.task;
                    applyPrompt = [
                      "Apply the requested changes directly in the selected repository.",
                      `Requested task: ${command.task}`,
                    ].join("\n");
                  } else {
                    const chatSummary = await deps.piRunner.getLastChatSummary(
                      chatId,
                      selectedRepo.repoName,
                      selectedRepo.repoPath,
                    );
                    if (!chatSummary) {
                      await deps.telegram.sendMessage(
                        chatId,
                        formatTelegramMessage("❓", "No Plan Yet", [
                          "Describe what you want to change first.",
                        ]),
                        "HTML",
                      );
                      break;
                    }
                    const inferredLabel = deriveTaskLabelFromIntent(lastChatIntentByChatRepo, chatId, selectedRepo.repoName)
                      ?? deriveTaskLabelFromHistory(taskHistory, selectedRepo.repoName)
                      ?? deriveTaskLabelFromChatSummary(chatSummary);
                    if (!inferredLabel) {
                      await deps.telegram.sendMessage(
                        chatId,
                        formatTelegramMessage("❓", "Missing Task Name", [
                          `Could not infer a clear task label from context.`,
                          `Use ${formatCode("/apply <short-task-name>")} for this run.`,
                        ]),
                        "HTML",
                      );
                      break;
                    }
                    applyLabel = inferredLabel;
                    summarySource = chatSummary;
                    applyPrompt = [
                      "Apply the changes described in the prior conversation summary.",
                      "Conversation summary:",
                      chatSummary,
                    ].join("\n");
                  }

                  const existingPlannedTask = findMergeablePlannedTask(taskHistory, selectedRepo.repoName, applyLabel);
                  const applyEntry = existingPlannedTask
                    ?? createTaskEntry(
                      selectedRepo.repoName,
                      applyLabel,
                      "apply",
                      "running",
                      summarySource ?? applyLabel,
                    );
                  applyEntry.mode = "apply";
                  applyEntry.status = "running";
                  applyEntry.summary = summarizeTaskText(summarySource ?? applyLabel);
                  currentTask = applyEntry;
                  if (!taskHistory.includes(applyEntry)) {
                    addTaskHistory(taskHistory, applyEntry);
                  }
                  markTaskHistoryDirty();

                  applyLock = true;
                  applyLockSince = Date.now();
                  logger.info("apply workflow started");
                  logger.debug("acknowledging webhook before apply run");
                  respondOk();
                  await deps.telegram.sendMessage(
                    chatId,
                    formatTelegramMessage("🚀", "Starting Apply", [
                      "Creating branch, running task, and opening PR.",
                    ]),
                    "HTML",
                  );

                  try {
                    if (!cfg.isDev) {
                      await fetchRemoteRepo(selectedRepo, deps.execCommand);
                    } else {
                      logger.debug("dev mode; skipping git fetch at apply start");
                    }
                    const branch = await deps.createFeatureBranch(selectedRepo, applyLabel);
                    const promptWithBranch = [
                      applyPrompt,
                      "",
                      `You are on branch ${branch}. Do not checkout or commit to any other branch.`,
                    ].join("\n");
                    const runOutput = await deps.piRunner.run(
                      chatId,
                      "apply",
                      promptWithBranch,
                      selectedRepo.repoName,
                      selectedRepo.repoPath,
                    );
                    applyEntry.summary = summarizeTaskText(runOutput);
                    markTaskHistoryDirty();

                    await ensureOnBranch(selectedRepo, branch, deps.execCommand);

                    if (!cfg.isDev) {
                      await fetchRemoteRepo(selectedRepo, deps.execCommand);
                    } else {
                      logger.debug("dev mode; skipping git fetch before commit");
                    }

                    let token = await deps.tokenProvider.getToken(selectedRepo.repoName);
                    const commit = await deps.commitAll(
                      selectedRepo,
                      branch,
                      `chore(agent): ${truncateOneLine(applyLabel, 80)}`,
                      token,
                    );
                    if (!commit.changed) {
                      applyEntry.status = "no-changes";
                      markTaskHistoryDirty();
                      await deps.telegram.sendMessage(
                        chatId,
                        formatTelegramMessage("ℹ️", "No Changes Created", [
                          truncateTelegram(runOutput),
                        ]),
                        "HTML",
                      );
                      break;
                    }
                    try {
                      await deps.pushBranch(selectedRepo, branch, token);
                    } catch (error) {
                      if ((error as Error).message !== "AUTH_FAILED") throw error;
                      logger.debug("push failed with auth; forcing token refresh", { branch });
                      token = await deps.tokenProvider.forceRefresh(selectedRepo.repoName);
                      await deps.pushBranch(selectedRepo, branch, token);
                    }

                    let prUrl = "";
                    try {
                      await verifyBranchReadyForPr(selectedRepo, branch, deps.execCommand);

                      const prTitle = `agent: ${truncateOneLine(applyLabel, 72)}`;
                      const prBody = await renderPullRequestBody({
                        repoPath: selectedRepo.repoPath,
                        sessionDir: cfg.sessionDir,
                        task: applyLabel,
                        agentSummary: runOutput,
                        commitSummary: commit.summary,
                        branch,
                        baseBranch: selectedRepo.repoBaseBranch,
                        repoName: selectedRepo.repoName,
                        repoOwner: selectedRepo.repoOwner,
                      });

                      try {
                        prUrl = await deps.createPullRequest(selectedRepo, branch, prTitle, prBody, token);
                      } catch (error) {
                        if ((error as Error).message !== "AUTH_FAILED") throw error;
                        logger.debug("pr create failed with auth; forcing token refresh", { branch });
                        token = await deps.tokenProvider.forceRefresh(selectedRepo.repoName);
                        prUrl = await deps.createPullRequest(selectedRepo, branch, prTitle, prBody, token);
                      }
                    } catch (error) {
                      logger.warn("apply preflight or pr create failed", {
                        branch,
                        error: (error as Error).message,
                      });
                      applyEntry.status = "failed";
                      markTaskHistoryDirty();
                      await deps.telegram.sendMessage(
                        chatId,
                        formatTelegramMessage("⚠️", "Failed to Open PR", [
                          formatTelegramRow("📁", "Branch", formatCode(branch)),
                          formatTelegramRow("❗", "Reason", formatCode((error as Error).message)),
                        ]),
                        "HTML",
                      );
                      break;
                    }

                    applyEntry.status = "applied";
                    markTaskHistoryDirty();
                    logger.info("apply workflow completed", { branch, prUrl });
                    await deps.telegram.sendMessage(
                      chatId,
                      formatTelegramMessage("✅", "Apply Completed", [
                        formatTelegramRow("📁", "Branch", formatCode(branch)),
                        formatTelegramRow(
                          "🔗",
                          "PR",
                          `<a href="${escapeHtml(prUrl)}">${escapeHtml(formatPrLinkLabel(prUrl))}</a>`,
                        ),
                      ]),
                      "HTML",
                    );
                  } finally {
                    if (applyEntry.status === "running") {
                      applyEntry.status = "failed";
                      markTaskHistoryDirty();
                    }
                    applyLock = false;
                    applyLockSince = null;
                    try {
                      await resetRepoToMain(selectedRepo, deps.execCommand);
                    } catch (error) {
                      await deps.telegram.sendMessage(
                        chatId,
                        formatTelegramMessage("⚠️", "Failed to Restore Repository", [
                          formatCode((error as Error).message),
                        ]),
                        "HTML",
                      );
                    }
                  }

                  break;
                }

                case "abort": {
                  const aborted = await deps.sessionManager.abort(chatId);
                  if (aborted && currentTask) {
                    currentTask.status = "aborted";
                    markTaskHistoryDirty();
                  }
                  await deps.telegram.sendMessage(
                    chatId,
                    aborted
                      ? formatTelegramMessage("🛑", "Run Aborted")
                      : formatTelegramMessage("ℹ️", "No Active Run"),
                    "HTML",
                  );
                  break;
                }

                default:
                  logger.debug("unknown command received", { text });
                  await deps.telegram.sendMessage(
                    chatId,
                    formatTelegramMessage("❓", "Unknown Command", [
                      `Use ${formatCode("/repo")}, ${formatCode("/status")}, ${formatCode("/tasks")}, ${formatCode("/task <number>")}, ${formatCode("/apply")}, ${formatCode("/abort")} or type your request.`,
                    ]),
                    "HTML",
                  );
              }
            } finally {
              clearInterval(typingInterval);
            }
            respondOk();
          },
        );
        recentlyProcessedUpdateIds.set(dedupeKey, Date.now());
        inFlightUpdateIds.delete(dedupeKey);
      } catch (error) {
        logger.error("webhook request failed", { error: (error as Error).message });
        const update = req.body as any;
        const chatId = update?.message?.chat?.id as number | undefined;
        const updateId = String(update?.update_id ?? "unknown");
        inFlightUpdateIds.delete(`${chatId ?? "unknown"}:${updateId}`);
        if (chatId) {
          await deps.telegram.sendMessage(
            chatId,
            formatTelegramMessage("⚠️", "Error", [
              formatCode((error as Error).message),
            ]),
            "HTML",
          ).catch(() => {});
        }
        if (!responseSent && !res.headersSent) {
          responseSent = true;
          res.status(500).json({ ok: false, error: (error as Error).message });
        }
      } finally {
        if (taskHistoryDirty) {
          await saveTaskHistory(taskHistoryStorePath, taskHistory).catch((error) => {
            logger.warn("failed to persist task history", { error: (error as Error).message });
          });
        }
      }
    });
  });

  return { app, telegram };
}

async function ensureOnBranch(
  repo: RepoContext,
  branch: string,
  runCommand: typeof execCommand,
): Promise<void> {
  const active = await currentBranch(repo, runCommand);
  if (active === branch) {
    logger.debug("apply branch confirmed", { branch });
    return;
  }

  logger.warn("apply branch mismatch", { expected: branch, actual: active });

  const ahead = await runCommand("git", ["rev-list", "--count", `origin/${repo.repoBaseBranch}..HEAD`], {
    cwd: repo.repoPath,
  });
  if (ahead.code !== 0) {
    throw new Error(`Unable to verify commit range against ${repo.repoBaseBranch}: ${ahead.stderr || ahead.stdout}`);
  }
  const aheadCount = Number.parseInt(ahead.stdout.trim(), 10);

  if (Number.isFinite(aheadCount) && aheadCount > 0) {
    const forceBranch = await runCommand("git", ["branch", "-f", branch, "HEAD"], { cwd: repo.repoPath });
    if (forceBranch.code !== 0) {
      throw new Error(`Unable to move ${branch} to HEAD: ${forceBranch.stderr || forceBranch.stdout}`);
    }
    logger.warn("apply branch forced to HEAD", { branch, active, aheadCount });

    if (active === repo.repoBaseBranch) {
      const reset = await runCommand("git", ["reset", "--hard", `origin/${repo.repoBaseBranch}`], {
        cwd: repo.repoPath,
      });
      if (reset.code !== 0) {
        throw new Error(
          `Unable to reset ${repo.repoBaseBranch} to origin/${repo.repoBaseBranch}: ${reset.stderr || reset.stdout}`,
        );
      }
      logger.info("base branch reset to origin", { branch: repo.repoBaseBranch });
    }
  }

  const checkout = await runCommand("git", ["checkout", branch], { cwd: repo.repoPath });
  if (checkout.code !== 0) {
    throw new Error(`Unable to checkout ${branch} from ${active}: ${checkout.stderr || checkout.stdout}`);
  }
  logger.info("apply branch corrected", { branch, previous: active });
}

async function verifyBranchReadyForPr(
  repo: RepoContext,
  branch: string,
  runCommand: typeof execCommand,
): Promise<void> {
  const ahead = await runCommand("git", ["rev-list", "--count", `origin/${repo.repoBaseBranch}..${branch}`], {
    cwd: repo.repoPath,
  });

  if (ahead.code !== 0) {
    throw new Error(`Unable to verify commit range against ${repo.repoBaseBranch}: ${ahead.stderr || ahead.stdout}`);
  }

  const aheadCount = Number.parseInt(ahead.stdout.trim(), 10);
  if (!Number.isFinite(aheadCount) || aheadCount <= 0) {
    throw new Error(`No commits ahead of ${repo.repoBaseBranch}; refusing to create PR.`);
  }

  const remoteHead = await runCommand("git", ["ls-remote", "--heads", "origin", branch], {
    cwd: repo.repoPath,
  });

  if (remoteHead.code !== 0 || !remoteHead.stdout.trim()) {
    throw new Error(`Remote branch ${branch} not found after push; refusing to create PR.`);
  }

  logger.debug("pr preflight passed", { branch, aheadCount });
}

async function currentBranch(repo: RepoContext, runCommand: typeof execCommand): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo.repoPath });
  if (result.code !== 0) return "unknown";
  return result.stdout.trim();
}

export function truncateTelegram(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 3800) return trimmed;
  return `${trimmed.slice(0, 3800)}\n\n[truncated]`;
}

export function truncateOneLine(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function createTaskEntry(
  repoName: string,
  label: string,
  mode: "chat" | "apply",
  status: TaskStatus,
  summary?: string,
): TaskEntry {
  return {
    repoName,
    label,
    slug: slugifyTask(label),
    mode,
    status,
    summary: summary ? summarizeTaskText(summary) : undefined,
    createdAt: new Date().toISOString(),
  };
}

function addTaskHistory(history: TaskEntry[], entry: TaskEntry): void {
  const maxTasks = 10;
  history.unshift(entry);
  if (history.length > maxTasks) {
    history.length = maxTasks;
  }
}

function formatTaskListLine(entry: TaskEntry, index: number): string {
  const status = formatTaskStatus(entry.status);
  const when = formatTaskRelativeTime(entry.createdAt);
  return `${index + 1}. <b>${escapeHtml(truncateOneLine(entry.label, 72))}</b> — ${status} • <code>${escapeHtml(entry.repoName)}</code> • ${escapeHtml(when)}`;
}

function formatTaskDetailLines(entry: TaskEntry): string[] {
  const status = formatTaskStatus(entry.status);
  const mode = entry.mode === "apply" ? "apply" : "chat";
  const when = formatTaskTime(entry.createdAt);
  const lines = [
    formatTelegramRow("🏷️", "Label", escapeHtml(entry.label)),
    formatTelegramRow("📌", "Status", status),
    formatTelegramRow("⚙️", "Mode", formatCode(mode)),
    formatTelegramRow("📦", "Repo", formatCode(entry.repoName)),
    formatTelegramRow("🧷", "Slug", formatCode(entry.slug)),
    formatTelegramRow("🕒", "Created", formatCode(when)),
  ];
  if (entry.summary) {
    lines.push(formatTelegramRow("📝", "Summary", escapeHtml(truncateOneLine(entry.summary, 1000))));
  }
  return lines;
}

function formatTaskStatus(status: TaskStatus): string {
  switch (status) {
    case "planned":
      return "📝 planned";
    case "running":
      return "⏳ running";
    case "applied":
      return "✅ applied";
    case "no-changes":
      return "ℹ️ no changes";
    case "aborted":
      return "🛑 aborted";
    case "failed":
    default:
      return "⚠️ failed";
  }
}

function formatTaskTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function formatTaskRelativeTime(iso: string): string {
  const date = new Date(iso);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return "unknown";
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function summarizeTaskText(text: string): string {
  return truncateOneLine(stripHtml(text), 140);
}

function deriveTaskLabelFromChatSummary(chatSummary: string): string | null {
  const plain = stripHtml(chatSummary)
    .split("\n")
    .map((line) => line.trim().replace(/^[•\-*]\s+/, "").replace(/^[^\w<]+/u, ""))
    .filter(Boolean)
    .find((line) => !/^(files?|plan|next|result|change|branch)\b[\s:.-]*/i.test(line) && !isGenericTaskLabel(line));

  if (!plain) return null;

  return truncateOneLine(plain, 80);
}

function deriveTaskLabelFromHistory(history: TaskEntry[], repoName: string): string | null {
  const latestChatTask = history.find((entry) => entry.repoName === repoName && entry.mode === "chat");
  if (!latestChatTask) return null;
  const label = latestChatTask.label.trim();
  if (!label || isGenericTaskLabel(label)) return null;
  return truncateOneLine(label, 80);
}

function deriveTaskLabelFromIntent(intentMap: Map<string, string>, chatId: number, repoName: string): string | null {
  const label = intentMap.get(makeChatRepoKey(chatId, repoName));
  if (!label || isGenericTaskLabel(label)) return null;
  return truncateOneLine(label, 80);
}

function findMergeablePlannedTask(history: TaskEntry[], repoName: string, label: string): TaskEntry | null {
  const slug = slugifyTask(label);
  const now = Date.now();
  const mergeWindowMs = 2 * 60 * 60 * 1000;
  for (const entry of history) {
    if (entry.repoName !== repoName) continue;
    if (entry.slug !== slug) continue;
    if (entry.mode !== "chat") continue;
    if (entry.status !== "planned") continue;
    const createdAtMs = Date.parse(entry.createdAt);
    if (Number.isFinite(createdAtMs) && now - createdAtMs > mergeWindowMs) continue;
    return entry;
  }
  return null;
}

function rememberChatIntent(intentMap: Map<string, string>, chatId: number, repoName: string, text: string): void {
  const label = truncateOneLine(text, 120);
  if (!label || isGenericTaskLabel(label)) return;
  intentMap.set(makeChatRepoKey(chatId, repoName), label);
}

function makeChatRepoKey(chatId: number, repoName: string): string {
  return `${chatId}:${repoName}`;
}

function isGenericTaskLabel(label: string): boolean {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "apply from context"
    || normalized === "apply planned changes"
    || normalized === "apply from chat"
    || normalized === "apply";
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function slugifyTask(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

async function fetchRemoteRepo(repo: RepoContext, runCommand: typeof execCommand): Promise<void> {
  logger.debug("git fetch start", { repoPath: repo.repoPath });
  const result = await runCommand("git", ["fetch", "origin", "--prune"], { cwd: repo.repoPath });
  assertSuccess(result, "git fetch");
  logger.info("git fetch complete", { repoPath: repo.repoPath });
}

export async function resetRepoToMain(repo: RepoContext, runCommand: typeof execCommand): Promise<void> {
  logger.warn("repo boundary reset start", { repoName: repo.repoName, baseBranch: repo.repoBaseBranch });
  const fetch = await runCommand("git", ["fetch", "origin", "--prune"], { cwd: repo.repoPath });
  assertSuccess(fetch, "git fetch");

  const checkout = await runCommand("git", ["checkout", "-B", repo.repoBaseBranch, `origin/${repo.repoBaseBranch}`], {
    cwd: repo.repoPath,
  });
  assertSuccess(checkout, "git checkout -B base");

  const reset = await runCommand("git", ["reset", "--hard", `origin/${repo.repoBaseBranch}`], {
    cwd: repo.repoPath,
  });
  assertSuccess(reset, "git reset --hard base");

  const clean = await runCommand("git", ["clean", "-fd"], { cwd: repo.repoPath });
  assertSuccess(clean, "git clean -fd");
  logger.warn("repo boundary reset complete", { repoName: repo.repoName, baseBranch: repo.repoBaseBranch });
}

function resolveRepoContext(cfg: AppConfig, repoName: string): RepoContext {
  return {
    repoName,
    repoOwner: cfg.repoOwner,
    repoPath: `${cfg.reposRoot.replace(/\/$/, "")}/${repoName}`,
    repoBaseBranch: cfg.repoBaseBranch,
  };
}

function requireSelectedRepo(
  chatId: number,
  selectedRepoByChatId: Map<number, string>,
  cfg: AppConfig,
): RepoContext | null {
  const repoName = selectedRepoByChatId.get(chatId);
  if (!repoName) return null;
  return resolveRepoContext(cfg, repoName);
}

function formatSupportedRepos(repoNames: string[]): string {
  return repoNames.join(", ");
}

function pruneProcessedUpdates(processed: Map<string, number>, windowMs: number, now: number): void {
  for (const [key, processedAt] of processed.entries()) {
    if (now - processedAt > windowMs) {
      processed.delete(key);
    }
  }
}

async function loadSelectedRepos(
  storePath: string,
  allowedRepoNames: string[],
  target: Map<number, string>,
): Promise<void> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    const allowed = new Set(allowedRepoNames);
    let restored = 0;

    for (const [chatIdRaw, repoName] of Object.entries(parsed)) {
      const chatId = Number.parseInt(chatIdRaw, 10);
      if (!Number.isFinite(chatId)) continue;
      if (!allowed.has(repoName)) continue;
      target.set(chatId, repoName);
      restored += 1;
    }

    logger.debug("selected repo map loaded", { restored });
  } catch {
    logger.debug("selected repo map not found; starting empty");
  }
}

async function saveSelectedRepos(storePath: string, selectedRepoByChatId: Map<number, string>): Promise<void> {
  const serialized = Object.fromEntries(
    [...selectedRepoByChatId.entries()]
      .sort(([left], [right]) => left - right)
      .map(([chatId, repoName]) => [String(chatId), repoName]),
  );
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(serialized, null, 2));
  logger.debug("selected repo map saved", { count: selectedRepoByChatId.size });
}

async function loadChatIntents(storePath: string, target: Map<string, string>): Promise<void> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    let restored = 0;
    for (const [key, label] of Object.entries(parsed)) {
      const safeLabel = truncateOneLine(label ?? "", 120);
      if (!safeLabel || isGenericTaskLabel(safeLabel)) continue;
      target.set(key, safeLabel);
      restored += 1;
    }
    logger.debug("chat intent map loaded", { restored });
  } catch {
    logger.debug("chat intent map not found; starting empty");
  }
}

async function saveChatIntents(storePath: string, intents: Map<string, string>): Promise<void> {
  const serialized = Object.fromEntries(
    [...intents.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, label]) => [key, label]),
  );
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(serialized, null, 2));
  logger.debug("chat intent map saved", { count: intents.size });
}

async function loadTaskHistory(storePath: string, target: TaskEntry[]): Promise<void> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as TaskEntry[];
    if (!Array.isArray(parsed)) {
      logger.warn("task history payload is invalid; starting empty");
      return;
    }

    const normalized = parsed
      .filter((entry) => entry && typeof entry === "object")
      .filter((entry) => typeof entry.repoName === "string" && typeof entry.label === "string" && typeof entry.slug === "string")
      .filter((entry) => entry.mode === "chat" || entry.mode === "apply")
      .filter((entry) => ["planned", "running", "applied", "no-changes", "failed", "aborted"].includes(entry.status))
      .slice(0, 10) as TaskEntry[];

    target.length = 0;
    target.push(...normalized);
    logger.debug("task history loaded", { count: normalized.length });
  } catch {
    logger.debug("task history not found; starting empty");
  }
}

async function saveTaskHistory(storePath: string, history: TaskEntry[]): Promise<void> {
  const payload = history.slice(0, 10);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(payload, null, 2));
  logger.debug("task history saved", { count: payload.length });
}

function formatTelegramMessage(icon: string, title: string, lines: string[] = []): string {
  const body = lines.map((line) => line.trim()).filter(Boolean).join("\n");
  return `${icon} <b>${escapeHtml(title)}</b>${body ? `\n${body}` : ""}`;
}

function formatTelegramRow(icon: string, label: string, value: string): string {
  return `${icon} <b>${escapeHtml(label)}</b>: ${value}`;
}

function formatCode(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatPrLinkLabel(prUrl: string): string {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!match) return "Open PR";
  const [, owner, repo, prNumber] = match;
  return `${owner}/${repo} - PR #${prNumber}`;
}
