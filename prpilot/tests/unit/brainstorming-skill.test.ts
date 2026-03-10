import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBrainstormingSkill } from "../../src/skills/brainstorming-skill.js";

describe("resolveBrainstormingSkill", () => {
  it("prefers repo override over global fallback", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "brainstorming-skill-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(path.join(repoPath, ".prpilot"), { recursive: true });
    await fs.mkdir(path.join(sessionDir, "templates"), { recursive: true });

    await fs.writeFile(
      path.join(repoPath, ".prpilot", "brainstorming-skill.md"),
      "repo brainstorming skill",
      "utf8",
    );
    await fs.writeFile(
      path.join(sessionDir, "templates", "brainstorming-skill.md"),
      "global brainstorming skill",
      "utf8",
    );

    await expect(resolveBrainstormingSkill({ repoPath, sessionDir })).resolves.toEqual({
      content: "repo brainstorming skill",
      source: "repo",
    });
  });

  it("uses global fallback when repo override is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "brainstorming-skill-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(path.join(sessionDir, "templates"), { recursive: true });

    await fs.writeFile(
      path.join(sessionDir, "templates", "brainstorming-skill.md"),
      "global brainstorming skill",
      "utf8",
    );

    await expect(resolveBrainstormingSkill({ repoPath, sessionDir })).resolves.toEqual({
      content: "global brainstorming skill",
      source: "global",
    });
  });

  it("uses built-in fallback when no files exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "brainstorming-skill-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });

    const resolved = await resolveBrainstormingSkill({ repoPath, sessionDir });

    expect(resolved.source).toBe("built-in");
    expect(typeof resolved.content).toBe("string");
    expect(resolved.content.length).toBeGreaterThan(0);
  });

  it("falls through to the next source when repo read fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "brainstorming-skill-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    const repoSkillPath = path.join(repoPath, ".prpilot", "brainstorming-skill.md");
    await fs.mkdir(path.dirname(repoSkillPath), { recursive: true });
    await fs.mkdir(path.join(sessionDir, "templates"), { recursive: true });

    await fs.writeFile(repoSkillPath, "repo brainstorming skill", "utf8");
    await fs.writeFile(
      path.join(sessionDir, "templates", "brainstorming-skill.md"),
      "global brainstorming skill",
      "utf8",
    );
    await fs.chmod(repoSkillPath, 0o000);

    try {
      await expect(resolveBrainstormingSkill({ repoPath, sessionDir })).resolves.toEqual({
        content: "global brainstorming skill",
        source: "global",
      });
    } finally {
      await fs.chmod(repoSkillPath, 0o644);
    }
  });

  it("falls through to built-in when global read fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "brainstorming-skill-"));
    const repoPath = path.join(root, "repo");
    const sessionDir = path.join(root, "session");
    const globalSkillPath = path.join(sessionDir, "templates", "brainstorming-skill.md");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(path.dirname(globalSkillPath), { recursive: true });

    await fs.writeFile(globalSkillPath, "global brainstorming skill", "utf8");
    await fs.chmod(globalSkillPath, 0o000);

    try {
      const resolved = await resolveBrainstormingSkill({ repoPath, sessionDir });
      expect(resolved.source).toBe("built-in");
      expect(typeof resolved.content).toBe("string");
      expect(resolved.content.length).toBeGreaterThan(0);
    } finally {
      await fs.chmod(globalSkillPath, 0o644);
    }
  });
});
