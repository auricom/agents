# Agent instructions

## Tool execution

- If a binary is unavailable on `PATH`, retry the intended command from the
  same working directory with `mise exec -- <binary> <arguments>`.
- Apply the same execution restrictions to commands run through mise.
- If mise also cannot provide the binary, report the blocker. Do not install
  tools or change mise configuration automatically.

## Infrastructure safety

Allow infrastructure code edits, linting, syntax checks, validation, and
previews that do not modify managed systems or remote state. Local formatting,
caches, initialization files, and saved plan files are permitted.

### Ansible

- Allow `ansible-lint` and `ansible-playbook --syntax-check`, `--list-tasks`,
  `--list-tags`, and `--list-hosts`.
- Allow `ansible` and `ansible-playbook` in `--check` mode, optionally with
  `--diff`, only after verifying that the selected tasks and plugins will not
  perform writes despite check mode.
- Do not assume `--check` guarantees no changes: tasks with
  `check_mode: false` can still run normally. `--diff` alone is not a dry run.
- Never execute Ansible operations that modify managed systems.
- If uncertain whether an operation can write, do not execute it.

### Terraform

- Allow `fmt`, `validate`, `show`, `providers`, `state list`, and `state show`.
- Allow `plan`, including `-out` for a local plan file.
- Allow `init` only without backend migration or state modification.
- Never execute `apply`, `destroy`, `import`, `refresh`, state mutations,
  workspace mutations, or backend/state migrations.

### Indirect execution

- These restrictions also apply through mise, scripts, task runners,
  Makefiles, containers, subprocesses, and MCP tools.
- Never bypass these restrictions or request approval to execute a prohibited
  operation. Leave execution of those operations to the human.
