#!/usr/bin/env python3
"""
Generate a GitHub App installation access token for use with gh CLI.
Outputs the token to stdout for capture by shell scripts.
"""

import os
import sys
import argparse
import jwt
import requests
import time
from pathlib import Path


def generate_jwt(app_id: str, private_key_path: str) -> str:
    """
    Generate a JWT (JSON Web Token) for GitHub App authentication.
    Valid for 10 minutes maximum.
    """
    private_key = Path(private_key_path).read_bytes()

    now = int(time.time())
    payload = {
        "iat": now,                    # Issued at
        "exp": now + 600,              # Expires at (10 minutes max)
        "iss": app_id                   # GitHub App ID
    }

    return jwt.encode(payload, private_key, algorithm="RS256")


def get_installation_id(jwt_token: str, owner: str, repo: str) -> int:
    """
    Find the installation ID for a specific repository.
    The GitHub App must be installed on this repository.
    """
    # First, try to get installation directly from repo
    response = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/installation",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    )

    if response.status_code == 200:
        return response.json()["id"]

    # Fallback: list all installations for the app and find matching one
    response = requests.get(
        "https://api.github.com/app/installations",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    )
    response.raise_for_status()

    installations = response.json()
    for inst in installations:
        # Check if this installation has access to the target repo
        inst_response = requests.get(
            inst["repositories_url"],
            headers={
                "Authorization": f"Bearer {jwt_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"
            }
        )
        if inst_response.status_code == 200:
            repos = inst_response.json()["repositories"]
            for r in repos:
                if r["full_name"] == f"{owner}/{repo}":
                    return inst["id"]

    raise RuntimeError(f"GitHub App not installed on {owner}/{repo}")


def get_installation_token(jwt_token: str, installation_id: int) -> str:
    """
    Exchange JWT for a temporary installation access token.
    Valid for 1 hour.
    """
    response = requests.post(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    )
    response.raise_for_status()

    return response.json()["token"]


def main():
    parser = argparse.ArgumentParser(
        description="Generate GitHub App installation token for gh CLI"
    )
    parser.add_argument(
        "--app-id",
        required=True,
        help="GitHub App ID (found in App settings)"
    )
    parser.add_argument(
        "--private-key",
        required=True,
        help="Path to GitHub App private key (.pem file)"
    )
    parser.add_argument(
        "--owner",
        required=True,
        help="Repository owner (user or organization)"
    )
    parser.add_argument(
        "--repo",
        required=True,
        help="Repository name"
    )
    parser.add_argument(
        "--installation-id",
        type=int,
        help="Skip auto-discovery and use specific installation ID"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print debug info to stderr"
    )

    args = parser.parse_args()

    # Validate private key exists
    if not Path(args.private_key).exists():
        print(f"Error: Private key not found: {args.private_key}", file=sys.stderr)
        sys.exit(1)

    try:
        # Generate JWT for app authentication
        if args.verbose:
            print("Generating JWT...", file=sys.stderr)
        jwt_token = generate_jwt(args.app_id, args.private_key)

        # Get installation ID (auto-discover or use provided)
        if args.installation_id:
            installation_id = args.installation_id
            if args.verbose:
                print(f"Using provided installation ID: {installation_id}", file=sys.stderr)
        else:
            if args.verbose:
                print(f"Discovering installation ID for {args.owner}/{args.repo}...", file=sys.stderr)
            installation_id = get_installation_id(jwt_token, args.owner, args.repo)
            if args.verbose:
                print(f"Found installation ID: {installation_id}", file=sys.stderr)

        # Generate installation access token
        if args.verbose:
            print("Generating installation access token...", file=sys.stderr)
        token = get_installation_token(jwt_token, installation_id)

        # Output only the token to stdout (for shell capture)
        print(token)

        if args.verbose:
            print("Token expires in 1 hour", file=sys.stderr)

    except requests.HTTPError as e:
        print(f"GitHub API error: {e.response.status_code} - {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
