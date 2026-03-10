import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

export type BrainstormingSkillSource = "repo" | "global" | "built-in";

export interface ResolveBrainstormingSkillInput {
  repoPath: string;
  sessionDir: string;
}

export interface ResolvedBrainstormingSkill {
  content: string;
  source: BrainstormingSkillSource;
}

const builtInBrainstormingSkill = `# Brainstorming

- Clarify the user's goal before proposing implementation details.
- Surface assumptions, tradeoffs, and missing requirements.
- Prefer concise options with concrete recommendations.
- End planning output with a clear next-step recommendation.`;

export async function resolveBrainstormingSkill(
  input: ResolveBrainstormingSkillInput,
): Promise<ResolvedBrainstormingSkill> {
  const repoSkillPath = path.join(input.repoPath, ".prpilot", "brainstorming-skill.md");
  const globalSkillPath = path.join(input.sessionDir, "templates", "brainstorming-skill.md");

  const repoSkill = await readSkillFile(repoSkillPath, "repo");
  if (repoSkill !== null) {
    logger.debug("brainstorming skill source selected", { source: "repo", skillPath: repoSkillPath });
    return { content: repoSkill, source: "repo" };
  }

  const globalSkill = await readSkillFile(globalSkillPath, "global");
  if (globalSkill !== null) {
    logger.debug("brainstorming skill source selected", { source: "global", skillPath: globalSkillPath });
    return { content: globalSkill, source: "global" };
  }

  logger.debug("brainstorming skill source selected", { source: "built-in" });
  return { content: builtInBrainstormingSkill, source: "built-in" };
}

async function readSkillFile(skillPath: string, source: Exclude<BrainstormingSkillSource, "built-in">): Promise<string | null> {
  try {
    return await fs.readFile(skillPath, "utf8");
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      logger.debug("brainstorming skill file not found", { source, skillPath });
      return null;
    }

    logger.warn("failed to read brainstorming skill file; falling back", {
      source,
      skillPath,
      error: (error as Error).message,
    });
    return null;
  }
}
