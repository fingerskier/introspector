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
