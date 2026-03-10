import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const BUNDLED_TEMPLATES_DIR = path.resolve(srcDir, "../../templates");
export const BUNDLED_BRAINSTORMING_SKILL_PATH = path.join(BUNDLED_TEMPLATES_DIR, "brainstorming-skill.md");
export const BUNDLED_PR_BODY_TEMPLATE_PATH = path.join(BUNDLED_TEMPLATES_DIR, "pr-body-template.md");
