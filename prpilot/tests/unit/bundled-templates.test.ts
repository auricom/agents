import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_BRAINSTORMING_SKILL_PATH,
  BUNDLED_PR_BODY_TEMPLATE_PATH,
  BUNDLED_TEMPLATES_DIR,
} from "../../src/templates/paths.js";

describe("bundled template paths", () => {
  it("points at the bundled templates directory", () => {
    expect(path.basename(BUNDLED_TEMPLATES_DIR)).toBe("templates");
  });

  it("ships starter files from prpilot/templates", async () => {
    await expect(fs.readFile(BUNDLED_BRAINSTORMING_SKILL_PATH, "utf8")).resolves.toContain("# Brainstorming");
    await expect(fs.readFile(BUNDLED_PR_BODY_TEMPLATE_PATH, "utf8")).resolves.toContain("{{task}}");
  });
});
