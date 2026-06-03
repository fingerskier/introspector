# Insight Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, self-contained `.introspector/insights.html` insight graph (plus `insights.json`) that scores every file — code or prose — on one shared visual grammar, with an AI enrichment step layered on top.

**Architecture:** A four-pass pipeline of small pure modules — `edges.ts` (typed graph edges), `score.ts` (objective 0..1 scores + flags), `layout.ts` (deterministic coordinates), `insights.ts` (assembles the `Insights` object) — feeds `render-html.ts`, which emits one self-contained HTML file with the data embedded as JSON and an inline vanilla-SVG renderer. The CLI runs all passes unconditionally; the `/introspect` skill later fills AI-only judgment fields and re-renders.

**Tech Stack:** TypeScript run directly via Node ≥22.18 type-stripping (zero runtime deps), `node:test` for tests, vanilla SVG/JS inside the generated HTML.

---

## Prerequisites & conventions

- **Branch:** Work on the current `feat/insight-graph-spec` branch (or a fresh branch off it). This plan does **not** touch `mode` logic — the separate `remove-introspect-mode` branch owns that. New code ignores `inv.mode` entirely, so the two streams stay orthogonal and can be merged in either order.
- **Local Node is 22.13**, which is below the 22.18 type-stripping threshold. Run every test file explicitly with the strip flag:
  ```bash
  node --experimental-strip-types --test tests/<file>.test.ts
  ```
  (Plain `npm test` / `node --test` will MODULE_NOT_FOUND on `.ts` imports under this Node — use the command above.)
- **Spec:** `docs/superpowers/specs/2026-06-03-insight-graph-design.md` is the source of truth for the visual grammar and data model.
- **Tuning constants** live in the module that uses them, exported for tests. Defaults chosen here: `OVERSIZED_LOC = 400`, `STUB_WORDS = 50`, `PROSE_TARGET_WORDS = 300`.

## File structure

| File | Responsibility |
| --- | --- |
| `src/types.ts` (modify) | Add `EdgeType`, `Edge`, `NodeScores`, `ScoredNode`, `LayoutPoint`, `InsightNode`, `Insights`. |
| `src/edges.ts` (create) | `extractEdges(inventory, contents) → Edge[]`. Import/require/from resolution (code), link/flow/contains (prose), reuse test links. Never throws. |
| `src/score.ts` (create) | `scoreNodes(inventory, edges, contents) → ScoredNode[]`. Pure, deterministic objective scores + objective flags. |
| `src/layout.ts` (create) | `layout(nodes, edges) → LayoutPoint[]`. Deterministic grid grouped by module, ordered by id. No randomness/time. |
| `src/insights.ts` (create) | `buildInsights(inventory, contents) → Insights`. Orchestrates the three passes and assembles `InsightNode[]`. |
| `src/render-html.ts` (create) | `mapChannels(node) → {...}` (pure, tested) and `renderHtml(insights) → string` (full self-contained document). |
| `src/scan.ts` (modify) | Add `readTextContents(inventory) → Map<string,string>` helper. |
| `src/cli.ts` (modify) | After scan, build + write `insights.json` and `insights.html` unconditionally. |
| `skills/introspect/SKILL.md` (modify) | Add the AIproc enrichment step. |
| `tests/edges.test.ts`, `tests/score.test.ts`, `tests/layout.test.ts`, `tests/insights.test.ts`, `tests/render-html.test.ts` (create) | Per-module unit tests. |

---

## Task 1: Data-model types

**Files:**
- Modify: `src/types.ts` (append after the existing `Inventory` interface)
- Test: `tests/insights.test.ts` (create — shape/round-trip only for now)

- [ ] **Step 1: Write the failing test**

Create `tests/insights.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Insights, InsightNode, Edge } from '../src/types.ts';

test('Insights shape serializes and round-trips losslessly', () => {
  const node: InsightNode = {
    id: 'src/a.ts',
    kind: 'code',
    path: 'src/a.ts',
    layout: { x: 10, y: 20 },
    scores: { size: 42, test: 1, docAmount: 0.5, structure: null, quality: null },
    flags: ['untested'],
    notes: [],
  };
  const edge: Edge = { from: 'src/a.ts', to: 'src/b.ts', type: 'import' };
  const insights: Insights = {
    generatedAt: '2026-06-03T00:00:00.000Z',
    nodes: [node],
    edges: [edge],
    meta: { nodeCount: 1, edgeCount: 1, aiEnriched: false },
  };
  const round = JSON.parse(JSON.stringify(insights)) as Insights;
  assert.deepEqual(round, insights);
  assert.equal(round.nodes[0]!.scores.structure, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/insights.test.ts`
Expected: FAIL — `Cannot find module` / type exports (`Insights`, `InsightNode`, `Edge`) do not exist yet.

- [ ] **Step 3: Add the types**

Append to `src/types.ts` (after the `Inventory` interface):

```ts
export type EdgeType = 'import' | 'contains' | 'tests' | 'flow' | 'link';

export interface Edge {
  /** Source node id (a FileEntry.path). */
  from: string;
  /** Target node id (a FileEntry.path). */
  to: string;
  type: EdgeType;
}

export interface NodeScores {
  /** Raw extent: LOC (code) or word count (prose). */
  size: number;
  /** 0..1 test coverage; null when not applicable (prose/config). */
  test: number | null;
  /** 0..1; code: doc presence/comments; prose: completeness (stub→finished). */
  docAmount: number;
  /** 0..1; prose: link-integrity/orphan; code: cohesion (AI-filled, null until then). */
  structure: number | null;
  /** 0..1; AI-filled writing/doc quality; null renders neutral. */
  quality: number | null;
}

/** A node after deterministic scoring, before layout/notes are attached. */
export interface ScoredNode {
  id: string;
  kind: 'code' | 'doc';
  path: string;
  scores: NodeScores;
  flags: string[];
}

export interface LayoutPoint {
  id: string;
  x: number;
  y: number;
}

export interface InsightNode {
  id: string;
  kind: 'code' | 'doc';
  path: string;
  layout: { x: number; y: number };
  scores: NodeScores;
  /** Objective flags: 'untested' | 'oversized' | 'stub' | 'broken-link' | 'orphan'. */
  flags: string[];
  /** Short author-facing callouts (AI-filled). */
  notes: string[];
}

export interface Insights {
  generatedAt: string;
  nodes: InsightNode[];
  edges: Edge[];
  meta: { nodeCount: number; edgeCount: number; aiEnriched: boolean };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/insights.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/insights.test.ts
git commit -m "feat(insights): add insight-graph data-model types"
```

---

## Task 2: Code import edges (`edges.ts`)

The graph's nodes are files. This task builds `extractEdges` and its code half: `import`/`export … from`/`require` (TS/JS) and `import`/`from … import` (Python), resolved to in-repo file paths. Plus the reused `tests` edges. Prose edges come in Task 3.

**Files:**
- Create: `src/edges.ts`
- Test: `tests/edges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/edges.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractEdges } from '../src/edges.ts';
import type { Inventory } from '../src/types.ts';

/** Build a minimal inventory from a list of paths + their FileKind. */
function inv(files: Array<[string, string]>, tests: Inventory['tests'] = []): Inventory {
  return {
    name: 'demo',
    root: '/tmp/demo',
    generatedAt: '2026-06-03T00:00:00.000Z',
    mode: 'code' as Inventory['mode'],
    totals: { files: files.length, code: 0, test: 0, docs: 0, config: 0, asset: 0, other: 0, loc: 0 },
    languages: {},
    modules: [],
    tests,
    docs: [],
    files: files.map(([path, kind]) => ({
      path,
      kind: kind as Inventory['files'][number]['kind'],
      language: null,
      size: 0,
      loc: 0,
    })),
  };
}

test('resolves relative TS/JS imports to in-repo files', () => {
  const inventory = inv([
    ['src/a.ts', 'code'],
    ['src/b.ts', 'code'],
    ['src/util/index.ts', 'code'],
  ]);
  const contents = new Map<string, string>([
    ['src/a.ts', "import { b } from './b';\nimport u from './util';\n"],
    ['src/b.ts', 'export const b = 1;\n'],
    ['src/util/index.ts', 'export default {};\n'],
  ]);
  const edges = extractEdges(inventory, contents);
  const imports = edges.filter((e) => e.type === 'import');
  assert.deepEqual(
    imports.sort((x, y) => x.to.localeCompare(y.to)),
    [
      { from: 'src/a.ts', to: 'src/b.ts', type: 'import' },
      { from: 'src/a.ts', to: 'src/util/index.ts', type: 'import' },
    ],
  );
});

test('drops imports that resolve outside the repo', () => {
  const inventory = inv([['src/a.ts', 'code']]);
  const contents = new Map([['src/a.ts', "import x from 'left-pad';\nimport y from './missing';\n"]]);
  assert.deepEqual(extractEdges(inventory, contents), []);
});

test('parses require() and export-from', () => {
  const inventory = inv([['a.js', 'code'], ['b.js', 'code'], ['c.js', 'code']]);
  const contents = new Map([
    ['a.js', "const b = require('./b');\nexport { c } from './c';\n"],
    ['b.js', 'module.exports = {};\n'],
    ['c.js', 'export const c = 1;\n'],
  ]);
  const tos = extractEdges(inventory, contents).filter((e) => e.type === 'import').map((e) => e.to).sort();
  assert.deepEqual(tos, ['b.js', 'c.js']);
});

test('resolves Python import and from-import', () => {
  const inventory = inv([['pkg/a.py', 'code'], ['pkg/b.py', 'code'], ['pkg/sub/c.py', 'code']]);
  const contents = new Map([
    ['pkg/a.py', 'from pkg.b import thing\nimport pkg.sub.c\n'],
    ['pkg/b.py', 'thing = 1\n'],
    ['pkg/sub/c.py', 'x = 1\n'],
  ]);
  const tos = extractEdges(inventory, contents).filter((e) => e.type === 'import').map((e) => e.to).sort();
  assert.deepEqual(tos, ['pkg/b.py', 'pkg/sub/c.py']);
});

test('reuses inventory test links as tests edges', () => {
  const inventory = inv(
    [['src/a.ts', 'code'], ['src/a.test.ts', 'test']],
    [{ test: 'src/a.test.ts', targets: ['src/a.ts'] }],
  );
  const edges = extractEdges(inventory, new Map());
  assert.deepEqual(
    edges.filter((e) => e.type === 'tests'),
    [{ from: 'src/a.test.ts', to: 'src/a.ts', type: 'tests' }],
  );
});

test('never throws on unreadable/missing content', () => {
  const inventory = inv([['src/a.ts', 'code']]);
  assert.doesNotThrow(() => extractEdges(inventory, new Map()));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/edges.test.ts`
Expected: FAIL — `extractEdges` is not defined.

- [ ] **Step 3: Implement code edges + tests edges**

Create `src/edges.ts`:

```ts
import path from 'node:path';
import type { Edge, Inventory } from './types.ts';

/** Extensions tried (in order) when resolving an extensionless specifier. */
const RESOLVE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py'];
const INDEX_BASES = ['index', '__init__', 'mod'];

/** Normalize a joined path to forward slashes, no leading "./". */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Resolve a relative module specifier from `fromFile` to an in-repo file path,
 * or null if it points outside the known file set.
 */
function resolveRelative(fromFile: string, spec: string, fileSet: Set<string>): string | null {
  const baseDir = path.posix.dirname(norm(fromFile));
  const joined = norm(path.posix.normalize(path.posix.join(baseDir, spec)));
  if (joined.startsWith('..')) return null;
  if (fileSet.has(joined)) return joined;
  for (const ext of RESOLVE_EXTS) {
    if (fileSet.has(joined + ext)) return joined + ext;
  }
  for (const base of INDEX_BASES) {
    for (const ext of RESOLVE_EXTS) {
      const candidate = norm(`${joined}/${base}${ext}`);
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}

/** Resolve a dotted Python module ("pkg.sub.c") against the repo root. */
function resolvePython(spec: string, fileSet: Set<string>): string | null {
  const rel = spec.replace(/^\.+/, '').split('.').join('/');
  if (rel === '') return null;
  if (fileSet.has(`${rel}.py`)) return `${rel}.py`;
  if (fileSet.has(`${rel}/__init__.py`)) return `${rel}/__init__.py`;
  return null;
}

const JS_IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
const JS_BARE_IMPORT_RE = /import\s*['"]([^'"]+)['"]/g;
const JS_REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_FROM_RE = /^\s*from\s+([.\w]+)\s+import\s/gm;
const PY_IMPORT_RE = /^\s*import\s+([.\w]+)/gm;

function codeEdges(
  file: string,
  content: string,
  fileSet: Set<string>,
  isPython: boolean,
): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  const push = (to: string | null): void => {
    if (to && to !== file && !seen.has(to)) {
      seen.add(to);
      out.push({ from: file, to, type: 'import' });
    }
  };
  if (isPython) {
    for (const re of [PY_FROM_RE, PY_IMPORT_RE]) {
      for (const m of content.matchAll(re)) push(resolvePython(m[1]!, fileSet));
    }
  } else {
    for (const re of [JS_IMPORT_RE, JS_BARE_IMPORT_RE, JS_REQUIRE_RE]) {
      for (const m of content.matchAll(re)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) push(resolveRelative(file, spec, fileSet));
      }
    }
  }
  return out;
}

/**
 * Extract typed graph edges from an inventory plus a map of file text contents.
 * Best-effort and total: unknown languages and missing content yield no edges
 * for that file, never an exception.
 */
export function extractEdges(inventory: Inventory, contents: Map<string, string>): Edge[] {
  const fileSet = new Set(inventory.files.map((f) => f.path));
  const edges: Edge[] = [];

  for (const entry of inventory.files) {
    if (entry.kind !== 'code' && entry.kind !== 'test') continue;
    const content = contents.get(entry.path);
    if (!content) continue;
    const isPython = entry.path.endsWith('.py');
    edges.push(...codeEdges(entry.path, content, fileSet, isPython));
  }

  for (const link of inventory.tests) {
    for (const target of link.targets) {
      edges.push({ from: link.test, to: target, type: 'tests' });
    }
  }

  return edges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/edges.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/edges.ts tests/edges.test.ts
git commit -m "feat(insights): extract code import edges and reuse test links"
```

---

## Task 3: Prose edges — link, flow, contains (`edges.ts`)

Extend `extractEdges` with prose edges: Markdown links to in-repo files (`link`), reading-order between docs (`flow`), and directory containment from an index/README file to its siblings (`contains`, both code and prose).

**Files:**
- Modify: `src/edges.ts`
- Test: `tests/edges.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/edges.test.ts`:

```ts
test('extracts markdown links to in-repo files as link edges', () => {
  const inventory = inv([['docs/a.md', 'docs'], ['docs/b.md', 'docs']]);
  inventory.docs = [
    { path: 'docs/a.md', title: 'A', headings: [] },
    { path: 'docs/b.md', title: 'B', headings: [] },
  ];
  const contents = new Map([
    ['docs/a.md', '# A\n\nSee [B](./b.md) and [ext](https://x.com).\n'],
    ['docs/b.md', '# B\n'],
  ]);
  const links = extractEdges(inventory, contents).filter((e) => e.type === 'link');
  assert.deepEqual(links, [{ from: 'docs/a.md', to: 'docs/b.md', type: 'link' }]);
});

test('emits flow edges in document reading order', () => {
  const inventory = inv([['ch1.md', 'docs'], ['ch2.md', 'docs'], ['ch3.md', 'docs']]);
  inventory.docs = [
    { path: 'ch1.md', title: 'One', headings: [] },
    { path: 'ch2.md', title: 'Two', headings: [] },
    { path: 'ch3.md', title: 'Three', headings: [] },
  ];
  const flow = extractEdges(inventory, new Map()).filter((e) => e.type === 'flow');
  assert.deepEqual(flow, [
    { from: 'ch1.md', to: 'ch2.md', type: 'flow' },
    { from: 'ch2.md', to: 'ch3.md', type: 'flow' },
  ]);
});

test('an index/readme file contains its directory siblings', () => {
  const inventory = inv([
    ['docs/README.md', 'docs'],
    ['docs/a.md', 'docs'],
    ['docs/b.md', 'docs'],
  ]);
  inventory.docs = [
    { path: 'docs/README.md', title: 'Readme', headings: [] },
    { path: 'docs/a.md', title: 'A', headings: [] },
    { path: 'docs/b.md', title: 'B', headings: [] },
  ];
  const contains = extractEdges(inventory, new Map()).filter((e) => e.type === 'contains');
  assert.deepEqual(
    contains.sort((x, y) => x.to.localeCompare(y.to)),
    [
      { from: 'docs/README.md', to: 'docs/a.md', type: 'contains' },
      { from: 'docs/README.md', to: 'docs/b.md', type: 'contains' },
    ],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/edges.test.ts`
Expected: FAIL — the three new tests fail (no `link`/`flow`/`contains` edges produced yet).

- [ ] **Step 3: Implement prose edges**

In `src/edges.ts`, add a Markdown-link regex near the other regexes:

```ts
const MD_LINK_RE = /\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g;
const INDEX_FILE_RE = /(^|\/)(index|readme|__init__|mod)\.[a-z0-9]+$/i;
```

Add these helpers above `extractEdges`:

```ts
function linkEdges(file: string, content: string, fileSet: Set<string>): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(MD_LINK_RE)) {
    let spec = m[1]!;
    if (/^[a-z]+:/i.test(spec) || spec.startsWith('#') || spec.startsWith('mailto:')) continue;
    spec = spec.split('#')[0]!.split('?')[0]!;
    if (spec === '') continue;
    const to = resolveRelative(file, spec, fileSet);
    if (to && to !== file && !seen.has(to)) {
      seen.add(to);
      out.push({ from: file, to, type: 'link' });
    }
  }
  return out;
}

function flowEdges(docPaths: string[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < docPaths.length - 1; i++) {
    out.push({ from: docPaths[i]!, to: docPaths[i + 1]!, type: 'flow' });
  }
  return out;
}

function containsEdges(files: string[]): Edge[] {
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = path.posix.dirname(norm(f));
    const list = byDir.get(dir) ?? [];
    list.push(f);
    byDir.set(dir, list);
  }
  const out: Edge[] = [];
  for (const siblings of byDir.values()) {
    const index = siblings.find((s) => INDEX_FILE_RE.test(s));
    if (!index) continue;
    for (const sib of siblings) {
      if (sib !== index) out.push({ from: index, to: sib, type: 'contains' });
    }
  }
  return out;
}
```

In `extractEdges`, before the final `return edges;`, add the prose/containment passes:

```ts
  for (const entry of inventory.files) {
    if (entry.kind !== 'docs') continue;
    const content = contents.get(entry.path);
    if (content) edges.push(...linkEdges(entry.path, content, fileSet));
  }

  edges.push(...flowEdges(inventory.docs.map((d) => d.path)));
  edges.push(...containsEdges(inventory.files.map((f) => f.path)));

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/edges.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/edges.ts tests/edges.test.ts
git commit -m "feat(insights): add prose link, flow and containment edges"
```

---

## Task 4: Objective scoring (`score.ts`)

Pure deterministic scoring: `size`, `test`, `docAmount`, prose `structure`, and objective `flags`. AI-only fields (`quality`, code `structure`) stay null.

**Files:**
- Create: `src/score.ts`
- Test: `tests/score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/score.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreNodes, OVERSIZED_LOC, STUB_WORDS } from '../src/score.ts';
import type { Edge, Inventory } from '../src/types.ts';

function inv(files: Array<[string, string, number]>, tests: Inventory['tests'] = [], docs: Inventory['docs'] = []): Inventory {
  return {
    name: 'demo', root: '/tmp/demo', generatedAt: '2026-06-03T00:00:00.000Z',
    mode: 'code' as Inventory['mode'],
    totals: { files: files.length, code: 0, test: 0, docs: 0, config: 0, asset: 0, other: 0, loc: 0 },
    languages: {}, modules: [], tests, docs,
    files: files.map(([path, kind, loc]) => ({
      path, kind: kind as Inventory['files'][number]['kind'], language: null, size: loc * 10, loc,
    })),
  };
}

test('code file size is its LOC and kind is code', () => {
  const nodes = scoreNodes(inv([['src/a.ts', 'code', 120]]), [], new Map());
  const a = nodes.find((n) => n.id === 'src/a.ts')!;
  assert.equal(a.kind, 'code');
  assert.equal(a.scores.size, 120);
});

test('test coverage is 1 when a source is linked, 0 otherwise, and flags untested', () => {
  const inventory = inv(
    [['src/a.ts', 'code', 10], ['src/b.ts', 'code', 10], ['src/a.test.ts', 'test', 5]],
    [{ test: 'src/a.test.ts', targets: ['src/a.ts'] }],
  );
  const edges: Edge[] = [{ from: 'src/a.test.ts', to: 'src/a.ts', type: 'tests' }];
  const nodes = scoreNodes(inventory, edges, new Map());
  assert.equal(nodes.find((n) => n.id === 'src/a.ts')!.scores.test, 1);
  const b = nodes.find((n) => n.id === 'src/b.ts')!;
  assert.equal(b.scores.test, 0);
  assert.ok(b.flags.includes('untested'));
});

test('oversized code files are flagged', () => {
  const nodes = scoreNodes(inv([['big.ts', 'code', OVERSIZED_LOC + 1]]), [], new Map());
  assert.ok(nodes.find((n) => n.id === 'big.ts')!.flags.includes('oversized'));
});

test('prose size is word count; short docs are stubs', () => {
  const inventory = inv([['doc.md', 'docs', 1]], [], [{ path: 'doc.md', title: 'Doc', headings: [] }]);
  const contents = new Map([['doc.md', '# Doc\n\nonly a few words here\n']]);
  const node = scoreNodes(inventory, [], contents).find((n) => n.id === 'doc.md')!;
  assert.equal(node.kind, 'doc');
  assert.ok(node.scores.size < STUB_WORDS);
  assert.ok(node.flags.includes('stub'));
  assert.equal(node.scores.test, null);
});

test('a TODO/placeholder doc is a stub regardless of length', () => {
  const longWords = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
  const inventory = inv([['d.md', 'docs', 1]], [], [{ path: 'd.md', title: 'D', headings: [] }]);
  const contents = new Map([['d.md', `# D\n\nTODO: write this. ${longWords}\n`]]);
  const node = scoreNodes(inventory, [], contents).find((n) => n.id === 'd.md')!;
  assert.ok(node.flags.includes('stub'));
});

test('broken internal links lower prose structure and add a flag', () => {
  const inventory = inv(
    [['a.md', 'docs', 1], ['b.md', 'docs', 1]],
    [],
    [{ path: 'a.md', title: 'A', headings: [] }, { path: 'b.md', title: 'B', headings: [] }],
  );
  // a.md links to b.md (resolves) and to gone.md (broken)
  const contents = new Map([
    ['a.md', '# A\n\n[b](./b.md) [gone](./gone.md)\n'],
    ['b.md', '# B\n'],
  ]);
  const edges: Edge[] = [{ from: 'a.md', to: 'b.md', type: 'link' }];
  const a = scoreNodes(inventory, edges, contents).find((n) => n.id === 'a.md')!;
  assert.ok(a.scores.structure! < 1);
  assert.ok(a.flags.includes('broken-link'));
});

test('a node with no edges is flagged orphan', () => {
  const inventory = inv([['lonely.ts', 'code', 10], ['x.ts', 'code', 10]]);
  const edges: Edge[] = [{ from: 'x.ts', to: 'lonely.ts', type: 'import' }];
  const nodes = scoreNodes(inventory, edges, new Map());
  assert.ok(!nodes.find((n) => n.id === 'lonely.ts')!.flags.includes('orphan'));
  // a truly disconnected file:
  const inv2 = inv([['solo.ts', 'code', 10]]);
  const solo = scoreNodes(inv2, [], new Map()).find((n) => n.id === 'solo.ts')!;
  assert.ok(solo.flags.includes('orphan'));
});

test('config and asset files are skipped (no nodes)', () => {
  const nodes = scoreNodes(inv([['package.json', 'config', 1], ['logo.png', 'asset', 0]]), [], new Map());
  assert.equal(nodes.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/score.test.ts`
Expected: FAIL — `scoreNodes` is not defined.

- [ ] **Step 3: Implement scoring**

Create `src/score.ts`:

```ts
import type { Edge, Inventory, NodeScores, ScoredNode } from './types.ts';

export const OVERSIZED_LOC = 400;
export const STUB_WORDS = 50;
export const PROSE_TARGET_WORDS = 300;

const STUB_MARKER_RE = /\b(todo|tbd|fixme|placeholder|coming soon|wip)\b/i;
const COMMENT_LINE_RE = /^\s*(\/\/|#|\*|\/\*)/;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function countWords(content: string): number {
  const m = content.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function commentRatio(content: string): number {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return 0;
  let comments = 0;
  for (const line of lines) if (COMMENT_LINE_RE.test(line)) comments++;
  return comments / lines.length;
}

/**
 * Deterministic, side-effect-free scoring of every code/doc file in the
 * inventory. AI-only fields (quality, code structure) are left null.
 */
export function scoreNodes(
  inventory: Inventory,
  edges: Edge[],
  contents: Map<string, string>,
): ScoredNode[] {
  const fileSet = new Set(inventory.files.map((f) => f.path));
  const testedSources = new Set(
    edges.filter((e) => e.type === 'tests').map((e) => e.to),
  );
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.from);
    connected.add(e.to);
  }

  const nodes: ScoredNode[] = [];

  for (const entry of inventory.files) {
    if (entry.kind !== 'code' && entry.kind !== 'docs') continue;
    const kind: 'code' | 'doc' = entry.kind === 'code' ? 'code' : 'doc';
    const content = contents.get(entry.path) ?? '';
    const flags: string[] = [];
    const scores: NodeScores = {
      size: 0,
      test: null,
      docAmount: 0,
      structure: null,
      quality: null,
    };

    if (kind === 'code') {
      scores.size = entry.loc;
      scores.test = testedSources.has(entry.path) ? 1 : 0;
      scores.docAmount = clamp01(commentRatio(content) * 5);
      if (scores.test === 0) flags.push('untested');
      if (entry.loc > OVERSIZED_LOC) flags.push('oversized');
    } else {
      const words = countWords(content);
      scores.size = words;
      const hasStubMarker = STUB_MARKER_RE.test(content);
      const isStub = words < STUB_WORDS || hasStubMarker;
      scores.docAmount = isStub ? 0 : clamp01(words / PROSE_TARGET_WORDS);
      if (isStub) flags.push('stub');

      // Structure: penalise broken internal links. A markdown link whose
      // target does not resolve to an in-repo file is "broken".
      const linkTargets = [...content.matchAll(/\[[^\]]*\]\(\s*([^)\s#?]+)[^)]*\)/g)].map((m) => m[1]!);
      const internal = linkTargets.filter((t) => !/^[a-z]+:/i.test(t) && !t.startsWith('#'));
      const resolvedFromHere = new Set(
        edges.filter((e) => e.from === entry.path && e.type === 'link').map((e) => e.to),
      );
      const brokenCount = internal.filter((t) => {
        const norm = t.replace(/^\.\//, '').split('/').filter((s) => s !== '.').join('/');
        return resolvedFromHere.size === 0 ? !fileSet.has(norm) : false;
      }).length || internal.filter((t) => !hasMatchingEdge(t, resolvedFromHere)).length;
      if (brokenCount > 0) flags.push('broken-link');
      scores.structure = clamp01(1 - 0.25 * brokenCount);
    }

    if (!connected.has(entry.path)) flags.push('orphan');

    nodes.push({ id: entry.path, kind, path: entry.path, scores, flags });
  }

  return nodes;
}

/** True if a link spec corresponds to one of the already-resolved link edges. */
function hasMatchingEdge(spec: string, resolved: Set<string>): boolean {
  const norm = spec.replace(/^\.\//, '');
  for (const r of resolved) {
    if (r === norm || r.endsWith('/' + norm) || r.endsWith(norm)) return true;
  }
  return false;
}
```

> Note on `broken-link`: the resolved `link` edges (from Task 3) are the ground truth for what resolved. A doc's internal link counts as broken when it has no corresponding `link` edge. The helper keeps the rule in one place; the inline expression above is intentionally conservative (prefers false-negatives to over-flagging).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/score.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/score.ts tests/score.test.ts
git commit -m "feat(insights): deterministic node scoring and objective flags"
```

---

## Task 5: Deterministic layout (`layout.ts`)

Place every node at stable coordinates with no randomness or time seed, grouped by top-level module, ordered by sorted id, within a fixed viewport.

**Files:**
- Create: `src/layout.ts`
- Test: `tests/layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/layout.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layout, VIEWPORT } from '../src/layout.ts';

const nodes = [
  { id: 'src/db/c.ts', path: 'src/db/c.ts' },
  { id: 'src/api/a.ts', path: 'src/api/a.ts' },
  { id: 'src/api/b.ts', path: 'src/api/b.ts' },
  { id: 'README.md', path: 'README.md' },
];

test('places every node exactly once', () => {
  const pts = layout(nodes, []);
  assert.equal(pts.length, nodes.length);
  assert.deepEqual(
    pts.map((p) => p.id).sort(),
    nodes.map((n) => n.id).sort(),
  );
});

test('is deterministic — identical input yields identical coordinates', () => {
  assert.deepEqual(layout(nodes, []), layout(nodes, []));
  // and independent of input ordering:
  const shuffled = [nodes[2], nodes[0], nodes[3], nodes[1]];
  const a = new Map(layout(nodes, []).map((p) => [p.id, p]));
  const b = new Map(layout(shuffled, []).map((p) => [p.id, p]));
  for (const id of a.keys()) assert.deepEqual(a.get(id), b.get(id));
});

test('all coordinates fall within the viewport bounds', () => {
  for (const p of layout(nodes, [])) {
    assert.ok(p.x >= 0 && p.x <= VIEWPORT.width, `x in range: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= VIEWPORT.height, `y in range: ${p.y}`);
  }
});

test('handles the empty case', () => {
  assert.deepEqual(layout([], []), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/layout.test.ts`
Expected: FAIL — `layout` is not defined.

- [ ] **Step 3: Implement layout**

Create `src/layout.ts`:

```ts
import type { Edge, LayoutPoint } from './types.ts';

export const VIEWPORT = { width: 1200, height: 800, margin: 60 };

interface LayoutInput {
  id: string;
  path: string;
}

/** Top-level grouping key: first path segment, or "." for root files. */
function groupKey(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

/**
 * Deterministic layout: nodes are grouped by their top-level directory, groups
 * are ordered by name, nodes within a group by id. Each group occupies a column
 * band; nodes stack vertically. No randomness or time — identical input
 * (in any order) yields byte-identical output.
 */
export function layout(nodes: LayoutInput[], _edges: Edge[]): LayoutPoint[] {
  if (nodes.length === 0) return [];

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const key = groupKey(n.path);
    const list = groups.get(key) ?? [];
    list.push(n.id);
    groups.set(key, list);
  }

  const groupNames = [...groups.keys()].sort();
  const cols = groupNames.length;
  const { width, height, margin } = VIEWPORT;
  const usableW = width - 2 * margin;
  const usableH = height - 2 * margin;
  const colStep = cols > 1 ? usableW / (cols - 1) : 0;

  const points: LayoutPoint[] = [];
  groupNames.forEach((name, ci) => {
    const ids = (groups.get(name) ?? []).slice().sort();
    const rows = ids.length;
    const rowStep = rows > 1 ? usableH / (rows - 1) : 0;
    const x = cols > 1 ? margin + ci * colStep : width / 2;
    ids.forEach((id, ri) => {
      const y = rows > 1 ? margin + ri * rowStep : height / 2;
      points.push({ id, x: Math.round(x), y: Math.round(y) });
    });
  });

  return points.sort((a, b) => a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout.ts tests/layout.test.ts
git commit -m "feat(insights): deterministic module-grouped layout"
```

---

## Task 6: Assemble insights (`insights.ts`)

Orchestrate the three passes into one `Insights` object, attaching layout coordinates and empty `notes`, with `aiEnriched: false`.

**Files:**
- Create: `src/insights.ts`
- Test: `tests/insights.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/insights.test.ts`:

```ts
import { scan } from '../src/scan.ts';
import { readTextContents } from '../src/scan.ts';
import { buildInsights } from '../src/insights.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'node:test';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test('buildInsights produces a node per code/doc file with layout and meta', () => {
  write('src/a.ts', "import { b } from './b';\nexport const a = 1;\n");
  write('src/b.ts', 'export const b = 1;\n');
  write('README.md', '# Demo\n\nThis is the readme with enough words to not be a stub at all here.\n');
  const inventory = scan(dir);
  const contents = readTextContents(inventory);
  const insights = buildInsights(inventory, contents);

  assert.equal(insights.meta.aiEnriched, false);
  assert.equal(insights.meta.nodeCount, insights.nodes.length);
  assert.equal(insights.meta.edgeCount, insights.edges.length);
  // every node has a layout coordinate and empty notes
  for (const n of insights.nodes) {
    assert.ok(Number.isFinite(n.layout.x) && Number.isFinite(n.layout.y));
    assert.deepEqual(n.notes, []);
  }
  // the import edge from a -> b is present
  assert.ok(insights.edges.some((e) => e.type === 'import' && e.from === 'src/a.ts' && e.to === 'src/b.ts'));
  // generatedAt mirrors the inventory for determinism
  assert.equal(insights.generatedAt, inventory.generatedAt);
});

test('buildInsights JSON round-trips losslessly', () => {
  write('src/a.ts', 'export const a = 1;\n');
  const inventory = scan(dir);
  const insights = buildInsights(inventory, readTextContents(inventory));
  assert.deepEqual(JSON.parse(JSON.stringify(insights)), insights);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/insights.test.ts`
Expected: FAIL — `readTextContents` and `buildInsights` are not defined.

- [ ] **Step 3a: Add `readTextContents` to `scan.ts`**

In `src/scan.ts`, after the `scan` function, append an exported helper (reuse the existing `TEXT_KINDS` set and `maxReadBytes` convention):

```ts
/**
 * Read the text contents of every text-kind file in an inventory into a map
 * keyed by relative path. Best-effort: unreadable or oversized files are
 * skipped, never thrown. Used to feed the edges/score passes.
 */
export function readTextContents(
  inventory: Inventory,
  maxReadBytes = 512 * 1024,
): Map<string, string> {
  const contents = new Map<string, string>();
  for (const entry of inventory.files) {
    if (!TEXT_KINDS.has(entry.kind)) continue;
    if (entry.size > maxReadBytes) continue;
    try {
      contents.set(entry.path, fs.readFileSync(path.join(inventory.root, entry.path), 'utf8'));
    } catch {
      /* skip unreadable file */
    }
  }
  return contents;
}
```

- [ ] **Step 3b: Implement `insights.ts`**

Create `src/insights.ts`:

```ts
import { extractEdges } from './edges.ts';
import { scoreNodes } from './score.ts';
import { layout } from './layout.ts';
import type { InsightNode, Insights, Inventory } from './types.ts';

/**
 * Assemble the full Insights object from a scanned inventory and the text
 * contents of its files. Deterministic: timestamp mirrors the inventory and
 * all coordinates come from the stable layout pass. AI fields stay null/empty.
 */
export function buildInsights(inventory: Inventory, contents: Map<string, string>): Insights {
  const edges = extractEdges(inventory, contents);
  const scored = scoreNodes(inventory, edges, contents);
  const points = layout(
    scored.map((n) => ({ id: n.id, path: n.path })),
    edges,
  );
  const coordById = new Map(points.map((p) => [p.id, p]));

  const nodes: InsightNode[] = scored.map((n) => {
    const pt = coordById.get(n.id);
    return {
      id: n.id,
      kind: n.kind,
      path: n.path,
      layout: { x: pt ? pt.x : 0, y: pt ? pt.y : 0 },
      scores: n.scores,
      flags: n.flags,
      notes: [],
    };
  });

  return {
    generatedAt: inventory.generatedAt,
    nodes,
    edges,
    meta: { nodeCount: nodes.length, edgeCount: edges.length, aiEnriched: false },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/insights.test.ts`
Expected: PASS (3 tests — the original shape test plus the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/scan.ts src/insights.ts tests/insights.test.ts
git commit -m "feat(insights): assemble Insights from edges, scores and layout"
```

---

## Task 7: Self-contained HTML renderer (`render-html.ts`)

Two exports: a pure `mapChannels` (scores → pixel/colour channels, unit-tested without a DOM) and `renderHtml` (a complete standalone HTML document embedding the data + an inline SVG renderer).

**Files:**
- Create: `src/render-html.ts`
- Test: `tests/render-html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render-html.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapChannels, renderHtml, NEUTRAL_GRAY } from '../src/render-html.ts';
import type { InsightNode, Insights } from '../src/types.ts';

function node(over: Partial<InsightNode> = {}): InsightNode {
  return {
    id: 'src/a.ts', kind: 'code', path: 'src/a.ts', layout: { x: 1, y: 2 },
    scores: { size: 100, test: 1, docAmount: 0.5, structure: null, quality: null },
    flags: [], notes: [],
    ...over,
  };
}

test('radius grows with size but is bounded', () => {
  const small = mapChannels(node({ scores: { size: 1, test: 0, docAmount: 0, structure: null, quality: null } }));
  const big = mapChannels(node({ scores: { size: 100000, test: 0, docAmount: 0, structure: null, quality: null } }));
  assert.ok(big.r > small.r);
  assert.ok(big.r <= 48);
  assert.ok(small.r >= 4);
});

test('code border hue follows test coverage; healthy=green-ish', () => {
  const tested = mapChannels(node({ scores: { size: 10, test: 1, docAmount: 0, structure: null, quality: null } }));
  const untested = mapChannels(node({ scores: { size: 10, test: 0, docAmount: 0, structure: null, quality: null } }));
  assert.ok(tested.borderHue > untested.borderHue); // green hue > red hue
  assert.ok(untested.borderHue <= 20);
  assert.ok(tested.borderHue >= 110);
});

test('prose border hue follows structure, not test', () => {
  const doc = node({ kind: 'doc', scores: { size: 200, test: null, docAmount: 0.8, structure: 1, quality: null } });
  assert.equal(mapChannels(doc).borderHue, mapChannels(node({ kind: 'doc', scores: { ...doc.scores, structure: 1 } })).borderHue);
  assert.ok(mapChannels(doc).borderHue >= 110);
});

test('fill opacity scales with docAmount within [0.15,0.75]', () => {
  const dry = mapChannels(node({ scores: { size: 10, test: 1, docAmount: 0, structure: null, quality: null } }));
  const wet = mapChannels(node({ scores: { size: 10, test: 1, docAmount: 1, structure: null, quality: null } }));
  assert.ok(dry.fillOpacity >= 0.15 && dry.fillOpacity <= 0.75);
  assert.ok(wet.fillOpacity > dry.fillOpacity);
});

test('null quality renders the neutral gray fill', () => {
  const m = mapChannels(node({ scores: { size: 10, test: 1, docAmount: 0.5, structure: null, quality: null } }));
  assert.equal(m.fillHue, NEUTRAL_GRAY);
});

test('renderHtml is one self-contained document embedding the data', () => {
  const insights: Insights = {
    generatedAt: '2026-06-03T00:00:00.000Z',
    nodes: [node()],
    edges: [{ from: 'src/a.ts', to: 'src/b.ts', type: 'import' }],
    meta: { nodeCount: 1, edgeCount: 1, aiEnriched: false },
  };
  const html = renderHtml(insights);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<script type="application\/json" id="insights-data">/);
  assert.match(html, /src\/a\.ts/);
  assert.match(html, /<svg/);
  // no external assets / network
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<link[^>]+href/);
});

test('renderHtml escapes data safely (no closing script breakout)', () => {
  const insights: Insights = {
    generatedAt: '2026-06-03T00:00:00.000Z',
    nodes: [node({ id: '</script><b>x', path: '</script><b>x' })],
    edges: [],
    meta: { nodeCount: 1, edgeCount: 0, aiEnriched: false },
  };
  const html = renderHtml(insights);
  assert.doesNotMatch(html, /<\/script><b>x/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/render-html.test.ts`
Expected: FAIL — `mapChannels` / `renderHtml` not defined.

- [ ] **Step 3: Implement the renderer**

Create `src/render-html.ts`:

```ts
import type { Insights, InsightNode } from './types.ts';

/** Sentinel hue meaning "no quality score yet" — rendered as gray, not on the hue wheel. */
export const NEUTRAL_GRAY = -1;

const R_MIN = 4;
const R_MAX = 48;
const HUE_RED = 0;
const HUE_GREEN = 130;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** Map a 0..1 health value to a hue: 0 → red, 1 → green. */
function hue(v: number | null): number {
  if (v == null) return NEUTRAL_GRAY;
  return Math.round(lerp(HUE_RED, HUE_GREEN, v));
}

export interface Channels {
  r: number;
  borderHue: number;
  borderWidth: number;
  fillOpacity: number;
  /** A hue 0..360, or NEUTRAL_GRAY when quality is unknown. */
  fillHue: number;
}

/** Pure scores → visual channels. The only place scores meet pixels. */
export function mapChannels(node: InsightNode): Channels {
  const { scores, kind } = node;
  const borderBasis = kind === 'code' ? scores.test : scores.structure;
  // sqrt scaling so area (not radius) tracks size; +1 avoids log/sqrt of 0
  const r = Math.round(clamp01(Math.sqrt(scores.size) / Math.sqrt(2500)) * (R_MAX - R_MIN) + R_MIN);
  return {
    r,
    borderHue: borderBasis == null ? NEUTRAL_GRAY : hue(borderBasis),
    borderWidth: Math.round(lerp(1.5, 6.5, borderBasis ?? 0) * 10) / 10,
    fillOpacity: Math.round(lerp(0.15, 0.75, scores.docAmount) * 100) / 100,
    fillHue: hue(scores.quality),
  };
}

function escapeForScript(json: string): string {
  // Prevent a literal </script> in data from closing the embedding tag.
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * Render a complete, self-contained HTML document: the Insights data embedded
 * as JSON plus an inline vanilla-JS/SVG renderer. No external assets, no CDN,
 * no network — opens directly via file://.
 */
export function renderHtml(insights: Insights): string {
  const data = escapeForScript(JSON.stringify(insights));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Insight Graph — ${insights.nodes.length} nodes</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; background: #11141a; color: #e7eaf0; }
  header { padding: 10px 16px; border-bottom: 1px solid #222b38; }
  header b { font-size: 15px; }
  #wrap { display: grid; grid-template-columns: 1fr 260px; height: calc(100vh - 44px); }
  svg { width: 100%; height: 100%; background: #11141a; }
  .edge { stroke: #38455a; stroke-width: 1; opacity: 0.5; }
  .edge.tests { stroke-dasharray: 4 3; }
  .edge.flow { stroke: #4a5d7a; }
  .node { cursor: pointer; }
  .node.dim { opacity: 0.12; }
  aside { border-left: 1px solid #222b38; padding: 12px; overflow: auto; }
  .legend h3 { margin: 12px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #9aa6b8; }
  .legend p { margin: 2px 0; color: #c4ccda; }
  #tip { position: fixed; pointer-events: none; background: #1b2231; border: 1px solid #2d3a4f; border-radius: 6px; padding: 8px 10px; max-width: 320px; display: none; box-shadow: 0 6px 24px #0008; }
  #tip code { color: #9ad; }
  .flag { display: inline-block; background: #33405a; border-radius: 4px; padding: 0 6px; margin: 2px 2px 0 0; font-size: 11px; }
</style>
</head>
<body>
<header><b>🧭 Insight Graph</b> — ${insights.meta.nodeCount} nodes · ${insights.meta.edgeCount} edges · ${insights.meta.aiEnriched ? 'AI-enriched' : 'deterministic baseline'}</header>
<div id="wrap">
  <svg id="graph" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet"></svg>
  <aside class="legend">
    <h3>Size</h3><p>Node radius ≈ file size (LOC / words).</p>
    <h3>Border</h3><p>Hue + width = test coverage (code) or structural integrity (prose). Green healthy → red needs work.</p>
    <h3>Fill</h3><p>Opacity = documentation amount / completeness. Hue = quality (AI). Gray = not yet AI-scored.</p>
    <h3>Edges</h3><p>import · contains · tests (dashed) · flow · link.</p>
  </aside>
</div>
<div id="tip"></div>
<script type="application/json" id="insights-data">${data}</script>
<script>
(function () {
  var raw = document.getElementById('insights-data').textContent;
  var data = JSON.parse(raw);
  var SVGNS = 'http://www.w3.org/2000/svg';
  var R_MIN = 4, R_MAX = 48;
  function clamp01(n){ return n < 0 ? 0 : n > 1 ? 1 : n; }
  function lerp(a,b,t){ return a + (b-a)*clamp01(t); }
  function hue(v){ return v == null ? -1 : Math.round(lerp(0,130,v)); }
  function channels(n){
    var s = n.scores, basis = n.kind === 'code' ? s.test : s.structure;
    var r = Math.round(clamp01(Math.sqrt(s.size)/Math.sqrt(2500))*(R_MAX-R_MIN)+R_MIN);
    return {
      r: r,
      stroke: basis == null ? '#7a869a' : 'hsl(' + hue(basis) + ',70%,55%)',
      sw: Math.round(lerp(1.5,6.5, basis == null ? 0 : basis)*10)/10,
      fill: s.quality == null ? '#7a869a' : 'hsl(' + hue(s.quality) + ',60%,50%)',
      fo: Math.round(lerp(0.15,0.75,s.docAmount)*100)/100
    };
  }
  var svg = document.getElementById('graph');
  var byId = {}; data.nodes.forEach(function(n){ byId[n.id] = n; });
  var neighbors = {}; data.nodes.forEach(function(n){ neighbors[n.id] = {}; });
  data.edges.forEach(function(e){
    if (!byId[e.from] || !byId[e.to]) return;
    var a = byId[e.from].layout, b = byId[e.to].layout;
    var line = document.createElementNS(SVGNS,'line');
    line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
    line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
    line.setAttribute('class','edge ' + e.type);
    line.dataset.from = e.from; line.dataset.to = e.to;
    svg.appendChild(line);
    if (neighbors[e.from]) neighbors[e.from][e.to] = 1;
    if (neighbors[e.to]) neighbors[e.to][e.from] = 1;
  });
  var tip = document.getElementById('tip');
  data.nodes.forEach(function(n){
    var c = channels(n);
    var g = document.createElementNS(SVGNS,'circle');
    g.setAttribute('cx', n.layout.x); g.setAttribute('cy', n.layout.y);
    g.setAttribute('r', c.r);
    g.setAttribute('fill', c.fill); g.setAttribute('fill-opacity', c.fo);
    g.setAttribute('stroke', c.stroke); g.setAttribute('stroke-width', c.sw);
    g.setAttribute('class','node'); g.dataset.id = n.id;
    g.addEventListener('mousemove', function(ev){
      tip.style.display='block'; tip.style.left=(ev.clientX+14)+'px'; tip.style.top=(ev.clientY+14)+'px';
      var fl = n.flags.map(function(f){return '<span class="flag">'+f+'</span>';}).join('');
      var notes = n.notes.length ? '<p>'+n.notes.join('<br>')+'</p>' : '';
      tip.innerHTML = '<code>'+n.path+'</code><br>size '+n.scores.size+
        ' · test '+n.scores.test+' · docs '+n.scores.docAmount+
        ' · struct '+n.scores.structure+' · qual '+n.scores.quality+'<br>'+fl+notes;
    });
    g.addEventListener('mouseleave', function(){ tip.style.display='none'; });
    g.addEventListener('click', function(){
      var keep = neighbors[n.id] || {}; keep[n.id] = 1;
      document.querySelectorAll('.node').forEach(function(el){
        el.classList.toggle('dim', !keep[el.dataset.id]);
      });
      document.querySelectorAll('.edge').forEach(function(el){
        var on = el.dataset.from === n.id || el.dataset.to === n.id;
        el.style.opacity = on ? '0.9' : '0.06';
      });
    });
    svg.appendChild(g);
  });
  svg.addEventListener('click', function(ev){
    if (ev.target === svg) {
      document.querySelectorAll('.node').forEach(function(el){ el.classList.remove('dim'); });
      document.querySelectorAll('.edge').forEach(function(el){ el.style.opacity=''; });
    }
  });
})();
</script>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/render-html.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render-html.ts tests/render-html.test.ts
git commit -m "feat(insights): self-contained SVG insight-graph renderer"
```

---

## Task 8: Wire into the CLI

The CLI always emits the new artifacts after scanning. No new options.

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli.test.ts` (create — end-to-end on a temp dir)

- [ ] **Step 1: Write the failing test**

Create `tests/cli.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('CLI writes insights.json and insights.html into .introspector', () => {
  fs.writeFileSync(path.join(dir, 'a.ts'), "import './b';\nexport const a = 1;\n");
  fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n\nplenty of words here to avoid being flagged as a stub document.\n');

  execFileSync(process.execPath, ['--experimental-strip-types', CLI], { cwd: dir });

  const out = path.join(dir, '.introspector');
  const jsonPath = path.join(out, 'insights.json');
  const htmlPath = path.join(out, 'insights.html');
  assert.ok(fs.existsSync(jsonPath), 'insights.json written');
  assert.ok(fs.existsSync(htmlPath), 'insights.html written');

  const insights = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.ok(Array.isArray(insights.nodes) && insights.nodes.length >= 2);
  assert.equal(insights.meta.aiEnriched, false);

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /^<!doctype html>/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/cli.test.ts`
Expected: FAIL — `.introspector/insights.json` / `insights.html` are not written.

- [ ] **Step 3: Update the CLI**

In `src/cli.ts`, add imports near the top (after the existing `toMermaid` import):

```ts
import { scan, readTextContents } from './scan.ts';
import { buildInsights } from './insights.ts';
import { renderHtml } from './render-html.ts';
```

> Replace the existing `import { scan } from './scan.ts';` line with the combined import above (do not leave a duplicate `scan` import).

In `main()`, locate the block that writes `mindmap.md` / `mindmap.mmd` and add the insights artifacts immediately after it (still inside the non-`--stdout` path):

```ts
  fs.writeFileSync(path.join(outDir, 'mindmap.md'), markdown);
  fs.writeFileSync(path.join(outDir, 'mindmap.mmd'), toMermaid(inv) + '\n');

  const insights = buildInsights(inv, readTextContents(inv));
  fs.writeFileSync(path.join(outDir, 'insights.json'), JSON.stringify(insights, null, 2));
  fs.writeFileSync(path.join(outDir, 'insights.html'), renderHtml(insights));

  if (args.json) {
    fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(inv, null, 2));
  }
```

Update the final success message to mention the new deliverable:

```ts
  process.stdout.write(
    `Introspected ${inv.name}: ${inv.totals.files} files, ` +
      `${inv.modules.length} modules, ${inv.totals.test} tests.\n` +
      `Wrote ./${OUT_DIR}/mindmap.md and ./${OUT_DIR}/insights.html` +
      `${args.json ? `, ./${OUT_DIR}/inventory.json` : ''}.\n`,
  );
```

> If the `remove-introspect-mode` branch has not been merged, the existing message references `inv.mode`; replacing the whole `process.stdout.write(...)` block as above removes that reference cleanly. Leave the `scan(target, { mode: args.mode })` call as-is on this branch — it is harmless and mode removal is tracked separately.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/cli.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the whole suite**

Run:
```bash
node --experimental-strip-types --test tests/scan.test.ts tests/edges.test.ts tests/score.test.ts tests/layout.test.ts tests/insights.test.ts tests/render-html.test.ts tests/cli.test.ts
```
Expected: all tests PASS (existing scan suite stays green).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat(insights): emit insights.json and insights.html from the CLI"
```

---

## Task 9: Document the AIproc enrichment step in `SKILL.md`

No code — extend the skill so the AI pass reads `insights.json`, fills judgment-only fields, and re-renders. The slash command stays a bare `/introspect`.

**Files:**
- Modify: `skills/introspect/SKILL.md`

- [ ] **Step 1: Add an enrichment step**

In `skills/introspect/SKILL.md`, after the existing `## Step 4 — Write the enriched artifact` section (and before `## Step 5 — Report back`), insert:

```markdown
## Step 4b — Enrich the insight graph (AIproc)

The scanner also writes `./.introspector/insights.json` (data + objective
scores) and a self-contained `./.introspector/insights.html`. Three of the four
visual channels are already meaningful from the deterministic pass (size, test
coverage, documentation amount, prose structure). Your job is to fill the
**judgment-only** fields the heuristics cannot:

1. Read `insights.json`. Focus on nodes carrying `flags`
   (`untested`, `oversized`, `stub`, `broken-link`, `orphan`) and on the
   largest nodes — those are where author attention pays off.
2. Open a representative sample of those files (do **not** read everything).
3. For each sampled node, set judgment fields — and only these:
   - `scores.quality` (0..1) — code: documentation/comment quality; prose:
     writing quality. This drives the fill **hue** (gray until you set it).
   - `scores.structure` (0..1) for **code** nodes — cohesion / "doing too
     much" / layering (prose `structure` is already computed; leave it).
   - `notes[]` — one or two short, specific, author-facing callouts.
   - You may add subjective `flags` (e.g. `god-object`, `unclear-name`); keep
     the objective ones the scanner set.
4. Set `meta.aiEnriched` to `true`.
5. Re-render: rebuild `insights.html` from the updated `insights.json` using the
   bundled renderer so the page reflects your judgments:

   ```bash
   node -e "import('${CLAUDE_PLUGIN_ROOT}/src/render-html.ts').then(m => { const fs = require('fs'); const i = JSON.parse(fs.readFileSync('./.introspector/insights.json','utf8')); fs.writeFileSync('./.introspector/insights.html', m.renderHtml(i)); })"
   ```

Leave deterministic fields (`size`, `test`, `docAmount`, prose `structure`,
objective flags) untouched — re-running the scanner recomputes them and will
overwrite AI fields, so the enrichment is the *last* step.
```

Also update `## Step 5 — Report back` to mention the new artifact — change its first sentence to:

```markdown
Tell the user where the artifacts are (`./.introspector/mindmap.md` and the
interactive `./.introspector/insights.html`), show the Mermaid mindmap inline so
it renders, and offer to commit them or go deeper on any branch of the map.
```

- [ ] **Step 2: Verify the doc**

Run: `node --experimental-strip-types --test tests/cli.test.ts`
(Confirms the artifacts the doc references are actually produced — the doc has no test of its own.)
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skills/introspect/SKILL.md
git commit -m "docs(introspect): document the AIproc insight-graph enrichment step"
```

---

## Final verification

- [ ] **Run the full suite:**
  ```bash
  node --experimental-strip-types --test tests/scan.test.ts tests/edges.test.ts tests/score.test.ts tests/layout.test.ts tests/insights.test.ts tests/render-html.test.ts tests/cli.test.ts
  ```
  Expected: all PASS.
- [ ] **Smoke-test on this repo:** from the repo root, run `node --experimental-strip-types src/cli.ts`, then open `./.introspector/insights.html` in a browser and confirm nodes/edges render, hover tooltips work, and clicking a node highlights neighbors.
- [ ] **Optional strict typecheck** (needs deps): `npm install` then `npm run check` (`tsc --noEmit`) — confirms the new types line up.

---

## Self-review notes (author)

- **Spec coverage:** §3 pipeline → Tasks 2–8; §4 modules → Tasks 2–7 (one task per module); §5 data model → Task 1 (+ `ScoredNode`/`LayoutPoint` intermediates added for clean boundaries); §5 channel mapping → Task 7 `mapChannels`; §6 deterministic/AI split → score.ts (deterministic) + Task 9 (AI); §7 interaction (hover/click/legend) → Task 7 renderer; §8 degradation → edges/score never throw, null-tolerant renderer; §9 testing → per-module test files; §10 artifacts → Task 8 CLI; §11 thresholds → exported constants in `score.ts`.
- **Deferred per spec:** the optional dimension-emphasis toggle (§7) is intentionally **not** built in v1 — listed in the spec as cut-if-risky. Force layout, zoom/pan, search/filter all explicitly out of scope.
- **Signature note:** the spec sketched `extractEdges(files, inventory)` and `scoreNodes(inventory, edges)`; both need file text, so the implemented signatures take an explicit `contents: Map<string,string>` (keeps the functions pure and unit-testable without disk I/O). `readTextContents` bridges scan output to that map.
- **Type consistency:** `ScoredNode` (score.ts output) → `buildInsights` → `InsightNode` (adds `layout` + `notes`); `mapChannels` consumes `InsightNode`. Names match across tasks.
```
