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
