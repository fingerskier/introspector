import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Insights, InsightNode, Edge } from '../src/types.ts';

test('Insights shape serializes and round-trips losslessly', () => {
  const node: InsightNode = {
    id: 'src/a.ts',
    kind: 'code',
    path: 'src/a.ts',
    layout: { x: 10, y: 20 },
    scores: { size: 42, test: 0, docAmount: 0.5, structure: null, quality: null },
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
