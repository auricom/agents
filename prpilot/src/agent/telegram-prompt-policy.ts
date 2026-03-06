export const TELEGRAM_REPOSITORY_SELF_SERVICE_RULES = [
  "Use available repository tools directly, including git/gh/bash, whenever repo context is needed.",
  "Do not ask the Telegram user to run commands or paste git output when you can inspect it yourself.",
] as const;

export interface BuildTelegramAgentPromptInput {
  repoName: string;
  agentsInstructions: string;
  taskLabel: string;
  task: string;
  responseInstruction: string;
}

export function buildTelegramAgentPrompt(input: BuildTelegramAgentPromptInput): string {
  return [
    `Repository selected: ${input.repoName}`,
    "Primary instructions for this repository (from AGENTS.md):",
    input.agentsInstructions,
    "",
    ...TELEGRAM_REPOSITORY_SELF_SERVICE_RULES,
    "",
    input.taskLabel,
    input.task,
    "",
    input.responseInstruction,
  ].join("\n");
}
