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
