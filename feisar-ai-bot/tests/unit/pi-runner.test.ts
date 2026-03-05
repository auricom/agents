import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiRunner } from "../../src/agent/pi-runner.js";

function createSessionEntry() {
  return {
    busy: false,
    session: {
      messages: [],
      prompt: vi.fn().mockResolvedValue(undefined),
      getLastAssistantText: vi.fn().mockReturnValue("ok"),
    },
  };
}

describe("PiRunner", () => {
  it("injects using-superpowers instructions for chat mode", async () => {
    const repoPath = await createRepoWithAgents("repo rules for chat");
    const entry = createSessionEntry();
    const getSession = vi.fn().mockResolvedValue(entry);
    const runner = new PiRunner({ getSession } as any);

    await runner.run(123, "chat", "change ingress", "home-ops", repoPath);

    const prompt = entry.session.prompt.mock.calls[0][0] as string;
    expect(prompt).toContain("npx openskills read using-superpowers");
    expect(prompt).toContain("repo rules for chat");
    expect(prompt).toContain("change ingress");
  });

  it("injects using-superpowers instructions for apply mode", async () => {
    const repoPath = await createRepoWithAgents("repo rules for apply");
    const entry = createSessionEntry();
    const getSession = vi.fn().mockResolvedValue(entry);
    const runner = new PiRunner({ getSession } as any);

    await runner.run(123, "apply", "apply prompt body", "home-ops", repoPath);

    const prompt = entry.session.prompt.mock.calls[0][0] as string;
    expect(prompt).toContain("npx openskills read using-superpowers");
    expect(prompt).toContain("repo rules for apply");
    expect(prompt).toContain("apply prompt body");
  });
});

async function createRepoWithAgents(content: string): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "pi-runner-"));
  await fs.writeFile(path.join(repoPath, "AGENTS.md"), content, "utf8");
  return repoPath;
}
