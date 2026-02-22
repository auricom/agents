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
