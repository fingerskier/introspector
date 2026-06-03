import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { scan } from '../src/scan.ts';
import { toMermaid } from '../src/mindmap.ts';
import { toMarkdown } from '../src/report.ts';
import { classify, isTestFile } from '../src/classify.ts';

let dir: string;

function write(rel: string, content = '\n'): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'introspector-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('classify recognises code, tests, docs and config', () => {
  assert.equal(classify('src/api/server.ts'), 'code');
  assert.equal(classify('src/api/server.test.ts'), 'test');
  assert.equal(classify('tests/server.ts'), 'test');
  assert.equal(classify('test_utils.py'), 'test');
  assert.equal(classify('docs/guide.md'), 'docs');
  assert.equal(classify('README.md'), 'docs');
  assert.equal(classify('package.json'), 'config');
  assert.equal(classify('logo.png'), 'asset');
});

test('isTestFile detects common conventions', () => {
  assert.ok(isTestFile('foo.test.ts'));
  assert.ok(isTestFile('foo.spec.js'));
  assert.ok(isTestFile('test_foo.py'));
  assert.ok(isTestFile('foo_test.go'));
  assert.ok(isTestFile('tests/foo.rb'));
  assert.ok(!isTestFile('src/foo.ts'));
});

test('scan groups modules, links tests and detects code mode', () => {
  write('package.json', '{"name":"demo","main":"src/index.ts"}');
  write('README.md', '# Demo\n\nHello.\n');
  write('src/index.ts', 'export const x = 1;\nconsole.log(x);\n');
  write('src/api/server.ts', 'export function serve() {}\n');
  write('src/api/server.test.ts', 'import { serve } from "./server";\nserve();\n');
  write('src/db/client.ts', 'export const db = {};\n');

  const inv = scan(dir);

  assert.equal(inv.mode, 'code');
  assert.equal(inv.name, path.basename(dir));
  assert.ok(inv.totals.files >= 6);
  assert.equal(inv.totals.test, 1);

  const modulePaths = inv.modules.map((m) => m.path);
  assert.ok(modulePaths.includes('src/api'));
  assert.ok(modulePaths.includes('src/db'));

  const link = inv.tests.find((t) => t.test === 'src/api/server.test.ts');
  assert.ok(link, 'expected a test link for server.test.ts');
  assert.deepEqual(link!.targets, ['src/api/server.ts']);
});

test('scan detects docs mode and extracts headings', () => {
  write('intro.md', '# Intro\n\n## Background\n\n### Detail\n\ntext\n');
  write('chapter-2.md', '# Chapter Two\n\n## Plot\n');

  const inv = scan(dir);

  assert.equal(inv.mode, 'docs');
  assert.equal(inv.docs.length, 2);
  const intro = inv.docs.find((d) => d.path === 'intro.md');
  assert.ok(intro);
  assert.equal(intro!.title, 'Intro');
  assert.deepEqual(
    intro!.headings.map((h) => h.title),
    ['Intro', 'Background', 'Detail'],
  );
});

test('headings inside fenced code blocks are ignored', () => {
  write('doc.md', '# Title\n\n```\n# not a heading\n```\n\n## Real\n');
  const inv = scan(dir);
  const doc = inv.docs[0]!;
  assert.deepEqual(
    doc.headings.map((h) => h.title),
    ['Title', 'Real'],
  );
});

test('walk respects .gitignore and default ignores', () => {
  write('.gitignore', 'secret.txt\n*.log\n');
  write('secret.txt', 'nope');
  write('app.log', 'nope');
  write('keep.ts', 'export const k = 1;\n');
  write('node_modules/dep/index.js', 'module.exports = {};\n');

  const inv = scan(dir);
  const paths = inv.files.map((f) => f.path);
  assert.ok(paths.includes('keep.ts'));
  assert.ok(!paths.includes('secret.txt'));
  assert.ok(!paths.includes('app.log'));
  assert.ok(!paths.some((p) => p.startsWith('node_modules')));
});

test('toMermaid produces a valid mindmap header and a root node', () => {
  write('src/index.ts', 'export const x = 1;\n');
  write('README.md', '# Demo\n');
  const inv = scan(dir);
  const mm = toMermaid(inv);
  const lines = mm.split('\n');
  assert.equal(lines[0], 'mindmap');
  assert.match(lines[1]!, /root\(\(/);
  // No unescaped parentheses should leak into child labels.
  for (const line of lines.slice(2)) {
    assert.ok(!/[()]/.test(line), `unexpected parens in: ${line}`);
  }
});

test('toMarkdown embeds a mermaid block and the core sections', () => {
  write('src/index.ts', 'export const x = 1;\n');
  write('src/index.test.ts', 'import "./index";\n');
  const md = toMarkdown(scan(dir));
  assert.match(md, /```mermaid/);
  assert.match(md, /## Guided tour/);
  assert.match(md, /## Modules/);
  assert.match(md, /## What is tested/);
});
