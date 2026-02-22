# AGENTS

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke: `npx openskills read <skill-name>` (run in your shell)
  - For multiple: `npx openskills read skill-one,skill-two`
- The skill content will load with detailed instructions on how to complete the task
- Base directory provided in output for resolving bundled resources (references/, scripts/, assets/)

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
</usage>

<available_skills>

<skill>
<name>ansible-skill</name>
<description>Infrastructure automation with Ansible. Use for server provisioning, configuration management, application deployment, and multi-host orchestration. Includes playbooks for OpenClaw VPS setup, security hardening, and common server configurations.</description>
<location>project</location>
</skill>

<skill>
<name>coding-agent</name>
<description>Delegate coding tasks to Codex, Claude Code, or Pi agents via background process. Use when: (1) building/creating new features or apps, (2) reviewing PRs (spawn in temp dir), (3) refactoring large codebases, (4) iterative coding that needs file exploration. NOT for: simple one-liner fixes (just edit), reading code (use read tool), or any work in ~/clawd workspace (never spawn agents here). Requires a bash tool that supports pty:true.</description>
<location>project</location>
</skill>

<skill>
<name>frontend-design</name>
<description>Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.</description>
<location>project</location>
</skill>

<skill>
<name>gh-app-auth</name>
<description>Authenticate the gh CLI using a GitHub App installation token. Use when: gh commands fail with auth errors, GH_TOKEN needs to be set for a GitHub App (not a PAT), or any task requires a short-lived GitHub App token for repo access. Requires: GitHub App ID and a private key (.pem) file.</description>
<location>project</location>
</skill>

<skill>
<name>gh-issues</name>
<description>Fetch GitHub issues, spawn sub-agents to implement fixes and open PRs, then monitor and address PR review comments. Usage: /gh-issues [owner/repo] [--label bug] [--limit 5] [--milestone v1.0] [--assignee @me] [--fork user/repo] [--watch] [--interval 5] [--reviews-only] [--cron] [--dry-run] [--model glm-5] [--notify-channel -1002381931352]</description>
<location>project</location>
</skill>

<skill>
<name>github</name>
<description>GitHub operations via gh CLI: issues, PRs, CI runs, code review, API queries. Use when: (1) checking PR status or CI, (2) creating/commenting on issues, (3) listing/filtering PRs or issues, (4) viewing run logs. NOT for: complex web UI interactions requiring manual browser flows, bulk operations across many repos, or when gh auth is not configured.</description>
<location>project</location>
</skill>

<skill>
<name>mintlify</name>
<description>Build and maintain documentation sites with Mintlify. Use when creating docs pages, configuring navigation, adding components, or setting up API references.</description>
<location>project</location>
</skill>

<skill>
<name>mise</name>
<description>Use when a project-specific binary or tool is not found (command not found, no such file or directory, etc). Declares the missing tool in mise.toml at the project root and installs it via mise. Never suggest global installation for project-specific tools.</description>
<location>project</location>
</skill>

<skill>
<name>prepare-pr-v1</name>
<description>Prepare a GitHub PR for merge by rebasing onto main, fixing review findings, running gates, committing fixes, and pushing to the PR head branch. Use after /review-pr. Never merge or push to main.</description>
<location>project</location>
</skill>

<skill>
<name>skill-creator</name>
<description>Create or update AgentSkills. Use when designing, structuring, or packaging skills with scripts, references, and assets.</description>
<location>project</location>
</skill>

<skill>
<name>summarize</name>
<description>Summarize or extract text/transcripts from URLs, podcasts, and local files (great fallback for "transcribe this YouTube/video").</description>
<location>project</location>
</skill>

</available_skills>
<!-- SKILLS_TABLE_END -->

</skills_system>

<scripts_system priority="2">

## Available Scripts

Scripts in `.agent/scripts/` can be executed directly by agents. Use the appropriate interpreter based on the file extension.

<available_scripts>

<script>
<name>generate_github_app_token.py</name>
<path>.agent/scripts/generate_github_app_token.py</path>
<interpreter>python (.venv/bin/python)</interpreter>
<description>Generate a GitHub App installation access token (valid 1 hour) and print it to stdout. Use when GH_TOKEN needs to be obtained from a GitHub App rather than a PAT. Requires: --app-id, --private-key (path to .pem), --owner, --repo. Optional: --installation-id (skip auto-discovery), --verbose. Dependencies: install .agent/scripts/requirements.txt into .venv first.</description>
<usage>TOKEN=$(.venv/bin/python .agent/scripts/generate_github_app_token.py --app-id &lt;ID&gt; --private-key &lt;PEM&gt; --owner &lt;OWNER&gt; --repo &lt;REPO&gt;)</usage>
</script>

</available_scripts>

</scripts_system>

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

## Packaging Format

`.skill` files are ZIP archives with a `.skill` extension. The `package_skill.py` script validates before packaging — fix validation errors (frontmatter format, naming conventions, description completeness) before re-running.
