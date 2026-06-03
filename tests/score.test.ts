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
  const inv2 = inv([['solo.ts', 'code', 10]]);
  const solo = scoreNodes(inv2, [], new Map()).find((n) => n.id === 'solo.ts')!;
  assert.ok(solo.flags.includes('orphan'));
});

test('config and asset files are skipped (no nodes)', () => {
  const nodes = scoreNodes(inv([['package.json', 'config', 1], ['logo.png', 'asset', 0]]), [], new Map());
  assert.equal(nodes.length, 0);
});
