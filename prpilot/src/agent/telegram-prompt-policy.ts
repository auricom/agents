export const TELEGRAM_REPOSITORY_SELF_SERVICE_RULES = [
  "Use available repository tools directly whenever repo context is needed.",
  "Do not ask the Telegram user to run commands or paste output when you can inspect it yourself.",
  'In planning mode you have a "web" tool that runs lynx. Use it to search the internet, read documentation, or fetch URLs the user provides. Always use lynx with -dump for plain text output.',
] as const;

export interface BuildTelegramAgentPromptInput {
  repoName: string;
  agentsInstructions: string;
  taskLabel: string;
  task: string;
  responseInstruction: string;
  extraInstructions?: string;
}

export function buildTelegramAgentPrompt(input: BuildTelegramAgentPromptInput): string {
  const extraInstructions = input.extraInstructions?.trim();

  return [
    `Repository selected: ${input.repoName}`,
    "Primary instructions for this repository (from AGENTS.md):",
    input.agentsInstructions,
    "",
    ...TELEGRAM_REPOSITORY_SELF_SERVICE_RULES,
    ...(extraInstructions
      ? [
        "",
        "Additional planning instructions:",
        extraInstructions,
      ]
      : []),
    "",
    input.taskLabel,
    input.task,
    "",
    input.responseInstruction,
  ].join("\n");
}
