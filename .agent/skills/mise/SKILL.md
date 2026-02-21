---
name: mise
description: "Use when a project-specific binary or tool is not found (command not found, no such file or directory, etc). Declares the missing tool in mise.toml at the project root and installs it via mise. Never suggest global installation for project-specific tools."
---

# Mise Tool Management

When you encounter a `command not found` error or a project-specific binary is missing, **do not ask the user to install the tool globally** and do not give up. Manage it through `mise` instead.

## Steps to follow

1. **Identify the missing binary** from the error (e.g. `go: command not found`, `golangci-lint: No such file`)
2. **Locate the project root** — the directory containing the nearest `.git` folder
3. **Check for an existing `mise.toml`** at the project root
4. **Create or update `mise.toml`** to declare the missing tool under `[tools]`
5. **Run `mise install`** to install all declared tools
6. **Re-run the original command** prefixed with `mise exec --`

## mise.toml format

```toml
[tools]
go = "latest"
node = "lts"
python = "3.12"
rust = "latest"
bun = "latest"
deno = "latest"
golangci-lint = "latest"
just = "latest"
terraform = "latest"
kubectl = "latest"
```

- Use a specific version (e.g. `"1.24"`) when the project has an existing version constraint or lock file
- Use `"latest"` when no version is specified
- Use `"lts"` for Node.js when no version is pinned

Common tool identifiers recognised by mise:

| Binary          | mise tool name    |
|-----------------|-------------------|
| `go`            | `go`              |
| `node` / `npm`  | `node`            |
| `python`        | `python`          |
| `ruby`          | `ruby`            |
| `rust` / `cargo`| `rust`            |
| `java`          | `java`            |
| `deno`          | `deno`            |
| `bun`           | `bun`             |
| `golangci-lint` | `golangci-lint`   |
| `terraform`     | `terraform`       |
| `kubectl`       | `kubectl`         |
| `helm`          | `helm`            |
| `just`          | `just`            |
| `pnpm`          | `pnpm`            |

For tools not listed here, check https://mise.jdx.dev/registry.html for the correct identifier.

## Invoking binaries after installation

```bash
# Install all tools declared in mise.toml
mise install

# Run a command through mise (preferred for scripts)
mise exec -- go build ./...
mise exec -- golangci-lint run --fix ./...

# Or run directly — mise adds tools to PATH for the project session
go build ./...
```

## Rules

- **Never suggest global installation** (`brew install`, `apt install`, `npm install -g`, `cargo install`, etc.) for project-specific tooling
- **Always use `mise.toml`** at the project root — not `.tool-versions`, not shell rc files
- **If `mise.toml` already exists**, update it rather than recreating it
- **After adding a tool**, always run `mise install` before trying to use it
- **Prefer `mise exec --`** when running a command inline in scripts so the tool is guaranteed to be resolved through mise
