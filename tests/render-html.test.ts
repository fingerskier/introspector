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
  // A doc with healthy structure (1) but the code-only "test" channel left null
  // must still read green via structure. A second doc with broken structure (0)
  // must read red — proving structure, not test, drives the prose border.
  const healthy = mapChannels(node({ kind: 'doc', scores: { size: 200, test: null, docAmount: 0.8, structure: 1, quality: null } }));
  const broken = mapChannels(node({ kind: 'doc', scores: { size: 200, test: null, docAmount: 0.8, structure: 0, quality: null } }));
  assert.ok(healthy.borderHue >= 110, `healthy structure → green, got ${healthy.borderHue}`);
  assert.ok(broken.borderHue <= 20, `broken structure → red, got ${broken.borderHue}`);
  assert.ok(healthy.borderHue > broken.borderHue);
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

test('mapChannels pins exact channel values (determinism guard)', () => {
  const m = mapChannels(node({ scores: { size: 100, test: 1, docAmount: 0.5, structure: null, quality: null } }));
  // size 100: sqrt(100)/sqrt(2500) = 10/50 = 0.2 → 0.2*44+4 = 12.8 → round 13
  assert.equal(m.r, 13);
  // test 1 → hue lerp(0,130,1) = 130
  assert.equal(m.borderHue, 130);
  // basis 1 → borderWidth lerp(1.5,6.5,1) = 6.5
  assert.equal(m.borderWidth, 6.5);
  // docAmount 0.5 → fillOpacity lerp(0.15,0.75,0.5) = 0.45
  assert.equal(m.fillOpacity, 0.45);
});

test('mapChannels radius is clamped at both ends (determinism guard)', () => {
  const tiny = mapChannels(node({ scores: { size: 0, test: 0, docAmount: 0, structure: null, quality: null } }));
  const huge = mapChannels(node({ scores: { size: 10_000_000, test: 0, docAmount: 0, structure: null, quality: null } }));
  assert.equal(tiny.r, 4); // size 0 → sqrt0/50=0 → 0*44+4 = 4
  assert.equal(huge.r, 48); // clamp01 caps ratio at 1 → 1*44+4 = 48
});

test('embedded browser channels() agrees with the pure mapChannels (drift guard)', () => {
  // renderHtml() ships a hand-written browser-side channels(n) inside its <script>
  // string, SEPARATE from the unit-tested mapChannels(). They must stay numerically
  // in sync. Extract the embedded function and execute it in Node, then compare on the
  // numeric channels they share: r, sw (== borderWidth), fo (== fillOpacity). The
  // browser fn emits COLORS for stroke/fill (not the TS hue numbers), so we only
  // assert the gray null-path for those, not the hue values.
  const empty: Insights = {
    generatedAt: 'x', nodes: [], edges: [],
    meta: { nodeCount: 0, edgeCount: 0, aiEnriched: false },
  };
  const html = renderHtml(empty);

  // Match the whole `function channels(n){ ... }` block. The function body ends at a
  // line that is exactly two spaces + `}` (its indentation in the script).
  const m = html.match(/function channels\(n\)\{[\s\S]*?\n  \}/);
  assert.ok(m, 'embedded channels() function found in renderHtml output');

  // Provide the helper deps the browser channels() closes over (clamp01, lerp, hue,
  // R_MIN, R_MAX) — copied verbatim from the embedded script — then define and call
  // the extracted channels(). No DOM required.
  const browserChannels = new Function(
    'n',
    `
    var R_MIN = 4, R_MAX = 48;
    function clamp01(n){ return n < 0 ? 0 : n > 1 ? 1 : n; }
    function lerp(a,b,t){ return a + (b-a)*clamp01(t); }
    function hue(v){ return v == null ? -1 : Math.round(lerp(0,130,v)); }
    ${m[0]}
    return channels(n);
    `,
  ) as (n: InsightNode) => { r: number; sw: number; fo: number; stroke: string; fill: string };

  const cases: InsightNode[] = [
    // tested code node
    node({ scores: { size: 100, test: 1, docAmount: 0.5, structure: null, quality: null } }),
    // untested code node
    node({ scores: { size: 250, test: 0, docAmount: 0, structure: null, quality: null } }),
    // doc node with structure + quality
    node({ kind: 'doc', scores: { size: 800, test: null, docAmount: 0.8, structure: 0.6, quality: 0.4 } }),
    // size 0
    node({ scores: { size: 0, test: 0.5, docAmount: 1, structure: null, quality: null } }),
    // huge size (clamps)
    node({ scores: { size: 10_000_000, test: 0.25, docAmount: 0.3, structure: null, quality: 1 } }),
  ];

  for (const n of cases) {
    const ts = mapChannels(n);
    const br = browserChannels(n);
    assert.equal(br.r, ts.r, `r drift for ${JSON.stringify(n.scores)}`);
    assert.equal(br.sw, ts.borderWidth, `borderWidth/sw drift for ${JSON.stringify(n.scores)}`);
    assert.equal(br.fo, ts.fillOpacity, `fillOpacity/fo drift for ${JSON.stringify(n.scores)}`);
    // Guard the null/gray path: when the TS hue is the neutral sentinel, the browser
    // must emit the exact gray, not an hsl() color.
    if (ts.borderHue === NEUTRAL_GRAY) {
      assert.equal(br.stroke, '#7a869a', `stroke should be gray when borderHue is NEUTRAL_GRAY`);
    }
    if (ts.fillHue === NEUTRAL_GRAY) {
      assert.equal(br.fill, '#7a869a', `fill should be gray when fillHue is NEUTRAL_GRAY`);
    }
  }
});
