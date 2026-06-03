# introspector

Build a mindmap and guided tour of a repo.

`introspector` scans a codebase (or a set of documents) and produces two things:

- **A mindmap** — a [Mermaid](https://mermaid.js.org/) diagram of the concepts,
  modules, and how they relate.
- **A guided tour** — an ordered walkthrough that gets a newcomer productive fast,
  including *what is tested and how* for code, or chapter/section structure for prose.

It ships as a **Claude Code plugin** (skill, slash command, agent, and a SessionStart
hook) backed by a small, dependency-free **TypeScript scanner** you can also run on
its own.

## Input → Output

- **Run it on a codebase**
  - creates/updates a mindmap of concepts and modules
  - shows what's tested and how (tests are linked to the sources they exercise)
- **Run it on documentation or prose**
  - creates/updates a mindmap of concepts and chapters and/or sections

The artifacts are written to `<target>/.introspector/`:

| File | What it is |
| --- | --- |
| `mindmap.md` | Markdown report: embedded Mermaid mindmap + guided tour + tables |
| `mindmap.mmd` | The raw Mermaid `mindmap` diagram |
| `inventory.json` | Structured inventory (with `--json`) — modules, tests, doc outlines |

## How it works

**Scan deterministically, then enrich semantically.**

1. The TypeScript scanner walks the target (respecting `.gitignore`), classifies
   every file (code / test / docs / config / asset), groups files into modules,
   links test files to the sources they likely exercise, and extracts document
   heading outlines. It emits a deterministic baseline mindmap and `inventory.json`.
2. The Claude skill/agent reads that inventory and *enriches* it — naming concepts
   instead of folders, capturing relationships, describing how things are tested,
   and writing the narrative tour.

The scanner alone is useful and runs without an LLM; the Claude layer makes the map
meaningful.

## Usage

### As a Claude Code plugin

This repo is itself a plugin marketplace. Add it and install:

```
/plugin marketplace add fingerskier/introspector
/plugin install introspector@introspector
```

Then, in any project:

- Run the slash command: `/introspect [path] [--mode code|docs|mixed]`
- Or just ask: *"introspect this repo"* / *"give me a guided tour of `src/`"*
- Or delegate to the `introspector` subagent for a hands-off pass.

When a project already has a `.introspector/mindmap.md`, the bundled **SessionStart
hook** surfaces it automatically so Claude starts oriented.

### As a standalone CLI

Requires **Node.js ≥ 22.18** (the scanner runs TypeScript directly via type
stripping — no build step needed).

```bash
# scan the current directory
node src/cli.ts .

# scan another path, also emit inventory.json
node src/cli.ts path/to/project --json

# force a mode, or just print the report
node src/cli.ts ./docs --mode docs
node src/cli.ts . --stdout
```

Options: `-o, --out <dir>` (default `.introspector`), `-m, --mode code|docs|mixed|auto`,
`--json`, `--stdout`, `-h, --help`.

### As a library

```ts
import { scan, toMermaid, toMarkdown } from 'introspector';

const inventory = scan('path/to/project');
console.log(toMermaid(inventory));   // Mermaid mindmap string
console.log(toMarkdown(inventory));  // full Markdown report
```

## Project layout

```
.claude-plugin/      Plugin + marketplace manifests
skills/introspect/   The introspect skill (scan → enrich → write workflow)
commands/            /introspect slash command
agents/              introspector subagent
hooks/               SessionStart hook that surfaces an existing mindmap
src/                 TypeScript scanner (walk, classify, scan, mindmap, report, cli)
tests/               node:test suite for the scanner
```

## Development

```bash
npm install        # dev deps: typescript + @types/node
npm test           # run the scanner test suite (node:test)
npm run check      # type-check (tsc --noEmit)
npm run build      # optional: compile src/ -> dist/
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
