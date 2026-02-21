## Tool runner

- Always use `mise exec --` to run project binaries (go, golangci-lint, node, python, etc.)
- Example: `mise exec -- go build ./...`, `mise exec -- go test ./...`
- If a binary is not found, add it to `mise.toml` under `[tools]` at the project root and run `mise install`
