---
name: introspect
description: Build or update a mindmap and guided tour of a codebase or document set. Use when the user asks to "introspect", "map", "give a tour of", "explain the structure of", or "onboard me to" a repo, directory, or set of docs. Produces a Mermaid mindmap of concepts/modules plus a guided reading tour, enriched with semantic understanding.
---

# Introspect: mindmap + guided tour

Turn a repository (or a set of documents) into two artifacts:

1. **A mindmap** — a Mermaid diagram of the concepts, modules, and how they relate.
2. **A guided tour** — an ordered walkthrough that gets a newcomer productive fast,
   including *what is tested and how* for code, or chapter/section structure for prose.

The workflow is **scan deterministically, then enrich semantically**. A bundled
Node.js scanner does the mechanical inventory so you can spend your effort on the
parts that need judgement: naming concepts, grouping modules meaningfully, and
writing the narrative.

## When to use this skill

- "Introspect this repo" / "map the codebase" / "give me a tour"
- "Onboard me to `path/to/project`"
- "What's the structure of these docs?"
- A SessionStart where the user wants a quick orientation to an unfamiliar repo.

## Step 1 — Run the scanner

The scanner walks the target (respecting `.gitignore`), classifies files, groups
modules, links tests to their targets, and extracts document outlines. It writes a
deterministic baseline you will build on.

```bash
node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" <target-path> --json
```

- Default target is the current directory; pass a path to scan elsewhere.
- Add `--mode code|docs|mixed` only to override auto-detection.
- Outputs land in `<target>/.introspector/`:
  - `mindmap.md` — baseline report (Mermaid mindmap + tour + tables)
  - `mindmap.mmd` — the raw Mermaid diagram
  - `inventory.json` — the structured inventory you will read next

> Requires Node.js ≥ 22.18 (the scanner runs TypeScript directly via type
> stripping). If `node` is unavailable, fall back to doing the inventory by hand
> with Glob/Grep, following the same model described in `inventory.json`'s shape.

## Step 2 — Read the inventory

Read `<target>/.introspector/inventory.json`. It gives you, without re-reading the
whole tree: totals, languages, `modules[]` (with code/test/doc files and LOC),
`tests[]` (each test mapped to likely target sources), and `docs[]` (per-document
heading outlines). Use it to decide which files are worth opening.

## Step 3 — Enrich (the part that needs you)

The baseline groups by directory. Your job is to add meaning:

- **Open the entry points and the largest modules** (the baseline names them in the
  guided-tour section). Read enough to understand each module's *responsibility*.
- **Name concepts, not just folders.** Replace mechanical labels like `src/api`
  with what they actually are ("HTTP API layer", "Auth", "Persistence").
- **Capture relationships.** Note which modules depend on which (imports, calls).
- **For tests:** confirm the heuristic links, describe *how* things are tested
  (unit/integration/e2e, frameworks), and flag untested areas.
- **For prose/docs:** organize chapters/sections into themes; note the intended
  reading order and any prerequisites.

Keep the mindmap readable — aim for 3–6 top-level branches and avoid dumping every
file. Group aggressively; a mindmap is a map, not a file listing.

## Step 4 — Write the enriched artifact

Overwrite `<target>/.introspector/mindmap.md` with your enriched version. Preserve
the structure so it stays diffable and re-runnable:

1. A short title + one-paragraph summary of what this project *is*.
2. `## Mindmap` — a `mermaid` `mindmap` block. Validate it: the first line is
   `mindmap`, the root is `root((name))`, indentation is consistent (2 spaces per
   level), and labels contain **no** parentheses/brackets/quotes (they break
   Mermaid). The `mmLabel` helper in `src/mindmap.ts` shows the sanitization rules.
3. `## Guided tour` — a numbered, opinionated reading order with one line per stop
   explaining *why* it matters.
4. `## What is tested` (code) or `## Documentation outline` (prose).
5. `## Modules` / concept table for reference.

If a prior `mindmap.md` exists, treat this as an **update**: preserve still-accurate
prose and only revise what changed.

## Step 5 — Report back

Tell the user where the artifact is (`<target>/.introspector/mindmap.md`), show the
Mermaid mindmap inline so it renders, and offer to commit it or go deeper on any
branch of the map.

## Notes

- Never invent modules or tests that aren't in the inventory; verify by reading.
- For very large repos, lean on `inventory.json` and only open representative files
  per module rather than everything.
- The mindmap renders anywhere Mermaid is supported (GitHub, VS Code, mermaid.live).
