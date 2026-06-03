import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('CLI writes insights.json and insights.html into .introspector', () => {
  fs.writeFileSync(path.join(dir, 'a.ts'), "import './b';\nexport const a = 1;\n");
  fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n\nplenty of words here to avoid being flagged as a stub document.\n');

  execFileSync(process.execPath, ['--experimental-strip-types', CLI], { cwd: dir });

  const out = path.join(dir, '.introspector');
  const jsonPath = path.join(out, 'insights.json');
  const htmlPath = path.join(out, 'insights.html');
  assert.ok(fs.existsSync(jsonPath), 'insights.json written');
  assert.ok(fs.existsSync(htmlPath), 'insights.html written');

  const insights = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.ok(Array.isArray(insights.nodes) && insights.nodes.length >= 2);
  assert.equal(insights.meta.aiEnriched, false);

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /^<!doctype html>/i);
});
