---
description: Build or update a mindmap and guided tour of a repo or document set
argument-hint: "[path] [--mode code|docs|mixed]"
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

Introspect the target and produce a mindmap + guided tour.

Target: `$1` (default to the current directory if empty).

Follow the **introspect** skill's workflow:

1. Run the scanner to build the deterministic baseline:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" ${1:-.} --json $2
   ```
2. Read `${1:-.}/.introspector/inventory.json`.
3. Enrich the baseline: open entry points and the largest modules, name the
   concepts, capture relationships, and verify the test links (or, for prose,
   organize chapters/sections into themes with a reading order).
4. Overwrite `${1:-.}/.introspector/mindmap.md` with the enriched mindmap + tour,
   keeping the section structure so it stays diffable.
5. Show the Mermaid mindmap inline and tell me where the file lives.
