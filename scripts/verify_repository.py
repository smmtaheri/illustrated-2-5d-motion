#!/usr/bin/env python3
"""Check that the skill repository contains no private production artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
PRIVATE_DIRS = {
    "projects", "episodes", "input", "inputs", "output", "outputs", "renders",
    "reels", "videos", "recordings", "work", "tmp", "cache", ".cache",
    "node_modules", ".venv", "venv", "__pycache__", "calibration",
    "locked-reels", "reference-audio", "motion-examples",
}
SOURCE_SUFFIXES = {".md", ".py", ".cjs", ".js", ".mjs", ".json", ".yaml", ".yml", ".txt", ".svg"}
SOURCE_NAMES = {".gitignore", ".gitattributes", "LICENSE", "NOTICE"}
SECRET_MARKERS = [
    re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(rb"github_pat_[A-Za-z0-9_]{30,}"),
    re.compile(rb"sk-(?:proj-)?[A-Za-z0-9_-]{32,}"),
    re.compile(rb"AKIA[0-9A-Z]{16}"),
    re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="Also inspect every reachable historical blob")
    args = parser.parse_args()
    library = json.loads((ROOT / "assets/library.json").read_text())
    binaries = {row["path"]: row["sha256"] for row in library["files"]}
    problems: set[str] = set()

    def inspect(name: str, content: bytes) -> None:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or PRIVATE_DIRS.intersection(path.parts):
            problems.add(f"Private/generated path: {name}")
            return
        if name in binaries:
            if hashlib.sha256(content).hexdigest() != binaries[name]:
                problems.add(f"Shared library hash changed: {name}")
            return
        if path.suffix not in SOURCE_SUFFIXES and path.name not in SOURCE_NAMES:
            problems.add(f"Unapproved binary/archive/file type: {name}")
            return
        if any(part == ".env" or part.startswith(".env.") for part in path.parts) and path.name not in {".env.example", ".env.sample"}:
            problems.add(f"Local environment file: {name}")
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            problems.add(f"Binary disguised as source text: {name}")
            return
        if any(pattern.search(content) for pattern in SECRET_MARKERS):
            problems.add(f"Credential/private-key marker in {name} (value withheld)")

    names = sorted(set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard").decode().split("\0")) - {""})
    for name in names:
        file = ROOT / name
        if file.is_symlink():
            problems.add(f"Symlink is not part of the portable skill: {name}")
        elif file.is_file():
            inspect(name, file.read_bytes())
    missing = set(binaries) - set(names)
    if missing:
        problems.add("Missing shared library files: " + ", ".join(sorted(missing)))
    historical = 0
    if args.history:
        for row in git("rev-list", "--objects", "--all").decode().splitlines():
            if " " not in row:
                continue
            oid, name = row.split(" ", 1)
            if git("cat-file", "-t", oid).strip() == b"blob":
                historical += 1
                inspect(name, git("cat-file", "blob", oid))
    print(json.dumps({
        "status": "fail" if problems else "pass", "working_files_checked": len(names),
        "historical_blobs_checked": historical, "problems": sorted(problems),
        "scope": "Allowed paths/types, exact shared-library hashes and common credential markers; not an exhaustive secret or license audit.",
    }, indent=2))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
