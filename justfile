# skills/ is read by Claude Code (~/.claude/skills) and Codex (~/.agents/skills), both symlinked to this repo.

# Download latest versions of vendored skills (all, or the given names)
skills-update *names:
    ./scripts/update-skills.sh {{names}}

# Show pinned upstream commits
skills-status:
    @cat skills.lock
