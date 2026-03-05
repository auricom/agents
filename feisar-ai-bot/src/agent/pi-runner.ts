import fs from "node:fs/promises";
import path from "node:path";
import type { RunMode } from "../types.js";
import { logger } from "../utils/logger.js";
import { PiSessionManager } from "./session-manager.js";

export class PiRunner {
  constructor(private readonly sessions: PiSessionManager) {}

  async run(chatId: number, mode: RunMode, task: string, repoName: string, repoPath: string): Promise<string> {
    const writable = mode === "apply";
    logger.debug("pi run start", { chatId, mode, writable, repoName });
    const entry = await this.sessions.getSession(chatId, writable, repoName, repoPath);

    if (entry.busy) {
      logger.debug("pi session busy", { chatId, mode });
      throw new Error("Session is busy. Use /abort or wait for completion.");
    }

    entry.busy = true;
    try {
      const prompt = await this.buildPrompt(mode, task, repoName, repoPath);
      logger.debug("pi prompt dispatch", { chatId, mode, promptLength: prompt.length });
      await entry.session.prompt(prompt);
      const output = entry.session.getLastAssistantText();
      if (!output) {
        const msgCount = entry.session.messages.length;
        const roles = entry.session.messages.map((m: any) => m.role ?? m.type ?? "unknown").join(",");
        logger.warn("pi run: no assistant text found", { chatId, mode, msgCount, roles });
        return "Task completed, but no assistant response was produced. Please try again or rephrase your request.";
      }
      logger.debug("pi run complete", { chatId, mode, outputLength: output.length });
      return output;
    } finally {
      entry.busy = false;
    }
  }

  async getLastChatSummary(chatId: number, repoName: string, repoPath: string): Promise<string | null> {
    const entry = await this.sessions.getSession(chatId, false, repoName, repoPath);
    if (!entry.session.messages.length) return null;
    return entry.session.getLastAssistantText() ?? null;
  }

  private async buildPrompt(mode: RunMode, task: string, repoName: string, repoPath: string): Promise<string> {
    const agentsInstructions = await this.loadAgentsInstructions(repoPath);
    const superpowersPrelude = [
      "Before doing anything else, run this command and follow the loaded instructions for this response:",
      "npx openskills read using-superpowers",
      "You must apply that skill workflow before any further action.",
      "",
    ].join("\n");

    if (mode === "chat") {
      return [
        superpowersPrelude,
        `Repository selected: ${repoName}`,
        "Primary instructions for this repository (from AGENTS.md):",
        agentsInstructions,
        "",
        "User message from Telegram:",
        task,
        "",
        "Respond for Telegram. Keep it concise and actionable.",
      ].join("\n");
    }

    return [
      superpowersPrelude,
      `Repository selected: ${repoName}`,
      "Primary instructions for this repository (from AGENTS.md):",
      agentsInstructions,
      "",
      "Apply-mode task:",
      task,
      "",
      "Execute the task directly in the repository and summarize results for Telegram.",
    ].join("\n");
  }

  private async loadAgentsInstructions(repoPath: string): Promise<string> {
    const agentsPath = path.join(repoPath, "AGENTS.md");
    try {
      const content = await fs.readFile(agentsPath, "utf8");
      const trimmed = content.trim();
      if (!trimmed) {
        throw new Error("AGENTS.md is empty");
      }
      return trimmed;
    } catch (error) {
      logger.error("failed to load AGENTS.md for repository prompt construction", {
        repoPath,
        agentsPath,
        error: (error as Error).message,
      });
      throw new Error(`AGENTS.md is required at repository root: ${agentsPath}`);
    }
  }
}
