#!/usr/bin/env bash
# Download skills listed in skills.sources into skills/<name>, pinning resolved commits in skills.lock.
# Usage: update-skills.sh [name...]   (no args = all)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
sources="$root/skills.sources"
lock="$root/skills.lock"
touch "$lock"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Optional token for the GitHub API (unauthenticated limit is 60 req/h).
token="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
auth=()
[[ -n "$token" ]] && auth=(-H "Authorization: Bearer $token")

while read -r name repo path ref; do
  [[ -z "${name:-}" || "$name" == \#* ]] && continue
  if (($#)) && [[ " $* " != *" $name "* ]]; then continue; fi

  # Exact branch, then tag (peeled), else treat ref as a commit sha.
  sha="$(git ls-remote "https://github.com/$repo" "refs/heads/$ref" "refs/tags/$ref" "refs/tags/$ref^{}" \
    | awk -v r="$ref" '$2=="refs/heads/"r{h=$1} $2=="refs/tags/"r{t=$1} $2=="refs/tags/"r"^{}"{p=$1}
                       END{print h ? h : (p ? p : t)}')"
  [[ -z "$sha" && "$ref" =~ ^[0-9a-f]{40}$ ]] && sha="$ref"
  [[ -n "$sha" ]] || { echo "error: cannot resolve $repo@$ref" >&2; exit 1; }

  prev="$(awk -v n="$name" '$1==n{print $3}' "$lock")"
  if [[ "$prev" == "$sha" && -d "$root/skills/$name" ]]; then
    echo "$name: up to date (${sha:0:7})"
    continue
  fi

  # List the skill's files (one tree listing per repo@sha), then fetch each from raw.githubusercontent.com.
  tree="$tmp/${repo//\//_}-$sha.json"
  [[ -f "$tree" ]] || curl -fsSL "${auth[@]}" -o "$tree" \
    "https://api.github.com/repos/$repo/git/trees/$sha?recursive=1"
  src="$tmp/$name"
  jq -r --arg p "$path/" '.tree[] | select(.type == "blob" and (.path | startswith($p))) | .path' "$tree" \
    | while read -r f; do
        curl -fsSL --create-dirs -o "$src/${f#"$path"/}" "https://raw.githubusercontent.com/$repo/$sha/$f"
      done
  [[ -f "$src/SKILL.md" ]] || { echo "error: $repo/$path has no SKILL.md" >&2; exit 1; }

  rm -rf "$root/skills/$name"
  mv "$src" "$root/skills/$name"

  awk -v n="$name" '$1!=n' "$lock" > "$tmp/lock"
  echo "$name $repo $sha" >> "$tmp/lock"
  sort "$tmp/lock" > "$lock"
  echo "$name: ${prev:0:7} -> ${sha:0:7}"
done < "$sources"
