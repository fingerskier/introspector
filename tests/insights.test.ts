import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Insights, InsightNode, Edge } from '../src/types.ts';
import { scan, readTextContents } from '../src/scan.ts';
import { buildInsights } from '../src/insights.ts';

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

describe('buildInsights integration', () => {
  let dir: string;

  function write(rel: string, content: string): void {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

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
    for (const n of insights.nodes) {
      assert.ok(Number.isFinite(n.layout.x) && Number.isFinite(n.layout.y));
      assert.deepEqual(n.notes, []);
    }
    assert.ok(insights.edges.some((e) => e.type === 'import' && e.from === 'src/a.ts' && e.to === 'src/b.ts'));
    assert.equal(insights.generatedAt, inventory.generatedAt);
  });

  test('buildInsights JSON round-trips losslessly', () => {
    write('src/a.ts', 'export const a = 1;\n');
    const inventory = scan(dir);
    const insights = buildInsights(inventory, readTextContents(inventory));
    assert.deepEqual(JSON.parse(JSON.stringify(insights)), insights);
  });
});
