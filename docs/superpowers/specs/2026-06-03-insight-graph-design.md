# Design — Interactive Insight Graph

> Status: approved design (brainstorm). Date: 2026-06-03.
> Next step: implementation plan (writing-plans skill).

## 1. Goal

Add an **interactive, self-contained HTML insight graph** to the introspector:
`.introspector/insights.html`. It scores every node — code *or* prose — on one
shared visual grammar so a repo's **author** (who has an ownership/authorship
stake) can spot structure, gaps, misses, and hits at a glance.

The deterministic scanner renders a useful graph immediately; an **AI pass
("AIproc")** sharpens it with judgment that heuristics can't provide. This
mirrors the project's existing philosophy: a deterministic baseline enriched by
the Claude skill.

Non-goals (v1): physics/force layout, search/filter UI, multi-repo comparison,
historical/trend tracking, exporting to image formats.

## 2. Key decisions (from brainstorm)

1. **Output medium:** a standalone interactive HTML/SVG artifact (not a styled
   Mermaid graph, not a text-only report).
2. **Labor split:** the deterministic scanner computes the graph data and the
   objective scores; the AI step adds only judgment (quality, cohesion, notes).
3. **Edges are typed and content-aware:** code uses imports + containment;
   prose uses ToC containment + reading flow; cross-reference links may appear
   in either.
4. **Insights are spectrums, not binary badges:** every node carries continuous
   0..1 scores per axis; "hits" are simply the healthy end of each spectrum.
5. **Visual encoding (locked), works for code and prose:**

   | Channel | Code node | Prose / doc node |
   | --- | --- | --- |
   | Node size (radius) | LOC | word count |
   | Border (hue + stroke width) | test coverage | structural integrity (links resolve, headings sound, not orphan) |
   | Fill opacity | doc amount (has docs/refs) | completeness (stub → finished) |
   | Fill hue | doc quality (AI) | writing quality (AI) |
   | Edges | import · contains · tests | flow · contains · link |

   Green = healthy, red = needs work. Once the encoding is fixed, the feature
   reduces to **scoring each node** and a dumb renderer.
6. **Architecture:** two-stage, self-contained HTML, zero runtime dependencies
   (consistent with the repo's type-stripped TS, no-build ethos).

## 3. Pipeline

```
scan (TS, deterministic)
  → existing inventory (files, modules, tests, docs)
  + edges.ts      typed edges: imports (code) · contains/flow/links (prose)
  + score.ts      deterministic scores: size, test, docAmount, structure(prose)
  + layout.ts     STABLE coordinates (no randomness → clean, reviewable diffs)
  + insights.ts   → writes .introspector/insights.json
  + render-html.ts → writes .introspector/insights.html
                     (data embedded as JSON + inline vanilla-SVG renderer;
                      opens via file://, no network, no build)

AIproc = the /introspect skill enrichment step
  → reads insights.json, samples flagged nodes (reads real code/prose),
    fills JUDGMENT-only fields (quality hue, code cohesion, per-node notes),
    rewrites insights.json, re-renders insights.html
```

`/introspect` (and `node src/cli.ts`) remain **optionless** — they always emit
the full artifact set. The AI enrichment is a pure upgrade layered on top.

## 4. New modules

Each has a single, well-bounded responsibility (small files, easy to test and to
reason about):

- **`src/edges.ts`** — `extractEdges(files, inventory) → Edge[]`.
  - Code: TS/JS `import … from '…'`, `export … from '…'`, `require('…')`;
    Python `import x`, `from x import y`. Resolve to in-repo file paths where
    possible; drop edges that resolve outside the repo.
  - Prose: heading-containment (`contains`), document reading order (`flow`),
    Markdown links `[text](path)` to in-repo targets (`link`).
  - Test links reuse the existing heuristic (`tests` edge type).
  - Unknown languages degrade to containment edges only; never throw.

- **`src/score.ts`** — pure `scoreNodes(inventory, edges) → NodeScore[]`.
  Deterministic, side-effect free, fully unit-testable. Computes `size`,
  `test`, `docAmount`, and prose `structure`. Leaves AI-only fields null.

- **`src/layout.ts`** — deterministic `layout(nodes, edges) → {id,x,y}[]`.
  No `Math.random`, no time seed. Stable ordering (e.g., grouped by module,
  ordered by sorted id) so identical input yields byte-identical coordinates.

- **`src/insights.ts`** — assembles the `Insights` object from inventory +
  edges + scores + layout; serializes/round-trips JSON.

- **`src/render-html.ts`** — emits a single self-contained `insights.html`:
  an HTML template embedding the data in `<script type="application/json">`
  plus an inline vanilla-JS/SVG renderer. No external assets, no CDN.

## 5. Data model (added to `src/types.ts`)

```ts
export type EdgeType = 'import' | 'contains' | 'tests' | 'flow' | 'link';

export interface Edge {
  from: string;        // node id (file path)
  to: string;          // node id (file path)
  type: EdgeType;
}

export interface NodeScores {
  size: number;            // raw extent: LOC (code) or word count (prose)
  test: number | null;     // 0..1 test coverage; null = not applicable (prose)
  docAmount: number;       // 0..1; code: doc presence/refs; prose: completeness
  structure: number | null;// 0..1; prose: link-integrity/orphan; code: cohesion (AI-assisted)
  quality: number | null;  // 0..1; AI-filled; null until enriched → neutral render
}

export interface InsightNode {
  id: string;              // file path (matches FileEntry.path)
  kind: 'code' | 'doc';    // derived from FileKind
  path: string;
  layout: { x: number; y: number };
  scores: NodeScores;
  flags: string[];         // e.g. 'untested', 'oversized', 'stub', 'broken-link', 'orphan'
  notes: string[];         // short author-facing callouts (AI-filled)
}

export interface Insights {
  generatedAt: string;
  nodes: InsightNode[];
  edges: Edge[];
  meta: { nodeCount: number; edgeCount: number; aiEnriched: boolean };
}
```

**Renderer channel mapping** (the only place scores meet pixels):

```
radius        = f(scores.size)
borderHue     = hue( kind === 'code' ? scores.test : scores.structure )
borderWidth   = lerp(1.5, 6.5, kind === 'code' ? scores.test : scores.structure)
fillOpacity   = lerp(0.15, 0.75, scores.docAmount)
fillHue       = scores.quality == null ? NEUTRAL_GRAY : hue(scores.quality)
```

`hue(v)` maps 0→red (0°) … 1→green (~130°). Null scores render neutral and are
called out in the legend as "not yet AI-scored."

## 6. Deterministic vs AI split

**Deterministic (renders with zero AI — ~3 of 4 channels live):**
- `size` — LOC / word count.
- `test` — from existing test→source links; coverage = linked sources / sources.
- `docAmount` — code: presence of doc references/comments for the module;
  prose: completeness (length + stub/TODO/placeholder detection).
- prose `structure` — broken internal links, malformed headings, orphan
  detection (all detectable without judgment).
- `flags` that are objective: `untested`, `oversized` (LOC over threshold),
  `stub`, `broken-link`, `orphan`.

**AI ("AIproc") adds:**
- `quality` (fill hue) — code doc quality / prose writing quality.
- code `structure` refinement — cohesion / "doing too much" / layering.
- `notes` — short, specific, author-facing callouts on flagged nodes.

Without the AI pass the graph is already useful (size, test, docs-amount,
prose-structure); the AI pass makes fill hue meaningful and adds prose-quality
and prose notes.

## 7. Interaction (v1 — deliberately minimal)

- **Hover** a node → tooltip with path, all scores, flags, and notes.
- **Click** a node → highlight its edges and immediate neighbors.
- **Always-on legend** explaining size/border/fill and the spectrum.
- **Optional dimension emphasis toggle** (test / docs) — dims the channel not
  in focus; nice-to-have, cut if it complicates v1.
- No search box, no filter panel, no settings — YAGNI.

## 8. Error handling & degradation

- Unknown / unsupported languages: nodes still sized and placed; edges sparse;
  AI-only scores null. Never throw.
- Malformed `package.json` or unreadable files: already tolerated by the
  scanner; extend the same try/catch discipline to the new passes.
- AI step optional and idempotent: it overwrites only `scores.quality`,
  `scores.structure` (code), and `notes`/`flags`; the renderer tolerates any
  missing/null field.
- `insights.json` round-trip is additive — re-running the deterministic scan
  recomputes objective fields and preserves nothing AI-specific unless the AI
  step re-runs (documented expectation, not a silent merge).

## 9. Testing (TDD, red → green)

- `edges.ts` — TS/JS import & re-export parsing, `require`, Python
  `import`/`from`, Markdown link extraction, heading containment, document flow
  ordering; out-of-repo targets dropped; unknown lang → containment only.
- `score.ts` — coverage from synthetic test links; `docAmount`; stub /
  completeness detection; prose link-integrity and orphan detection. Pure-fn
  assertions on a hand-built inventory.
- `layout.ts` — determinism (same input ⇒ identical coords across runs);
  every node placed; coordinates within the viewport bounds.
- `insights.ts` — assembles a valid `Insights`; JSON serialize→parse round-trip
  is lossless.
- `render-html.ts` — output is a single HTML file that embeds the JSON and the
  renderer script; the channel-mapping pure function
  (`scores → {r, borderHue, borderWidth, fillOpacity, fillHue}`) is unit-tested
  independently of the DOM.
- Existing suite stays green throughout.

## 10. Artifacts & surfaces

`.introspector/` after a run:
- `mindmap.md`, `mindmap.mmd`, `inventory.json` (existing)
- **`insights.json`** (new — data + scores + layout)
- **`insights.html`** (new — the deliverable)

`SKILL.md` gains an enrichment step describing the AIproc pass (read
`insights.json`, sample flagged nodes, fill judgment scores + notes, rewrite and
re-render). The slash command stays a bare `/introspect` with no arguments.

## 11. Open questions / deferred

- Exact LOC/word thresholds for `oversized`/`stub` — pick defaults during
  implementation, expose as constants (not CLI options).
- Whether the dimension-emphasis toggle ships in v1 (cut if it adds risk).
- Force/physics layout and zoom/pan are explicitly deferred to a later version.
