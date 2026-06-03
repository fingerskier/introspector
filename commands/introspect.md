---
description: Build or update a mindmap and guided tour of the current repo or document set
argument-hint: "[--mode code|docs|mixed]"
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

Introspect the current working directory and produce a mindmap + guided tour.
The scan always targets the current repo; output lands in `./.introspector/` and
re-running overwrites it in place.

Follow the **introspect** skill's workflow:

1. Run the scanner to build the deterministic baseline:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" --json $1
   ```
2. Read `./.introspector/inventory.json`.
3. Enrich the baseline: open entry points and the largest modules, name the
   concepts, capture relationships, and verify the test links (or, for prose,
   organize chapters/sections into themes with a reading order).
4. Overwrite `./.introspector/mindmap.md` with the enriched mindmap + tour,
   keeping the section structure so it stays diffable.
5. Show the Mermaid mindmap inline and tell me where the file lives.
