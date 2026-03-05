import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoContext } from "../../src/types.js";

const execCommand = vi.fn();

vi.mock("../../src/utils/exec.js", () => ({
  execCommand,
  assertSuccess: (result: { code: number; stderr: string; stdout: string }, context: string) => {
    if (result.code !== 0) throw new Error(`${context} failed (${result.code}): ${result.stderr || result.stdout}`);
  },
}));

const { createPullRequest } = await import("../../src/git/pr.js");

function repo(): RepoContext {
  return {
    repoPath: "/tmp/repo",
    repoOwner: "owner",
    repoName: "repo",
    repoBaseBranch: "main",
  };
}

describe("createPullRequest", () => {
  beforeEach(() => {
    execCommand.mockReset();
  });

  it("uses explicit owner:branch in --head", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "https://example/pr/1\n", stderr: "" });

    await createPullRequest(repo(), "agent/my-branch", "title", "body", "token");

    expect(execCommand).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--head", "owner:agent/my-branch"]),
      expect.objectContaining({ cwd: "/tmp/repo" }),
    );
  });
});
