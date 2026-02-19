# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This repository stores AI agent skills (AgentSkills) — modular, self-contained packages that extend AI agents with specialized knowledge, workflows, and tools. Skills live in `.agent/skills/`.

## Tech Stack

- Node.js (managed via `mise` — run `mise install` to set up)
- Python scripts for skill tooling (no install needed, use system Python 3)

## Managing Skills

Skills are managed via the `openskills` CLI:

```bash
npx openskills install <source> --universal  # Install to .agent/skills/ (multi-agent setup)
npx openskills install <source>              # Install to .claude/skills/ (Claude Code only)
npx openskills update                        # Update all installed skills
npx openskills update <name,...>             # Update specific skills
npx openskills list                          # List installed skills
npx openskills remove <name>                 # Remove a skill
npx openskills manage                        # Remove skills interactively
npx openskills sync                          # Update AGENTS.md
```

Install sources can be a GitHub repo (`owner/repo`), a local path (`./my-skill`), or a private git URL. The `--universal` flag is what places skills under `.agent/skills/` — omitting it installs to `.claude/skills/` instead. Each installed skill gets a `.openskills.json` file recording the source and timestamp.

## Skill Tooling Commands

Skills are managed via Python scripts in `.agent/skills/skill-creator/scripts/`:

```bash
# Create a new skill directory from template
python .agent/skills/skill-creator/scripts/init_skill.py <skill-name> --path .agent/skills [--resources scripts,references,assets] [--examples]

# Package a skill into a distributable .skill file (validates first)
python .agent/skills/skill-creator/scripts/package_skill.py .agent/skills/<skill-name>
python .agent/skills/skill-creator/scripts/package_skill.py .agent/skills/<skill-name> ./dist

# Validate only (without packaging)
python .agent/skills/skill-creator/scripts/quick_validate.py .agent/skills/<skill-name>
```

## Skill Architecture

Every skill is a directory under `.agent/skills/<skill-name>/` containing:

```
skill-name/
├── SKILL.md           (required) — YAML frontmatter + markdown instructions
├── .openskills.json   (metadata about install source)
└── Optional resources:
    ├── scripts/       Executable code run directly by agents
    ├── references/    Documentation loaded into context as needed
    └── assets/        Files used in skill output (templates, fonts, etc.)
```

**SKILL.md structure:**
- YAML frontmatter with `name` and `description` fields only — the `description` is the primary trigger mechanism that determines when the skill activates
- Markdown body with instructions (loaded only after the skill triggers)

**Skill naming:** lowercase hyphen-case, max 64 characters (e.g., `my-skill`, `gh-issues`).

## Skill Design Principles

- **Concise is key**: The SKILL.md body should stay under 500 lines; move detailed content to `references/` files
- **Progressive disclosure**: Metadata (~100 words) is always in context; SKILL.md body loads on trigger; `references/` load only as needed
- **Description is the trigger**: All "when to use" guidance belongs in the frontmatter `description`, not the body
- **No extraneous files**: Do not create README.md, CHANGELOG.md, or other auxiliary docs inside skill directories
- The `references/` pattern works well for: API docs, schemas, detailed workflow guides, domain knowledge
- The `assets/` pattern works well for: templates, boilerplate code directories, fonts, images

## Installed Skills

| Skill | Purpose |
|-------|---------|
| `skill-creator` | Create/package new AgentSkills |
| `frontend-design` | Production-grade frontend UI with distinctive aesthetics |
| `prepare-pr-v1` | Rebase, fix review items, run gates, push PR head branch |
| `coding-agent` | Delegate tasks to Codex/Claude Code/Pi via background processes |
| `gh-issues` | Auto-fix GitHub issues with parallel sub-agents, handle PR reviews |
| `github` | GitHub operations via `gh` CLI |
| `summarize` | Summarize URLs, podcasts, local files |
| `mintlify` | Build/maintain Mintlify documentation sites |

## Packaging Format

`.skill` files are ZIP archives with a `.skill` extension. The `package_skill.py` script validates before packaging — fix validation errors (frontmatter format, naming conventions, description completeness) before re-running.
