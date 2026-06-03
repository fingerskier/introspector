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
