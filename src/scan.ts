import fs from 'node:fs';
import path from 'node:path';
import { classify, detectLanguage } from './classify.ts';
import { walk, type WalkOptions } from './walk.ts';
import type {
  DocHeading,
  DocSection,
  FileEntry,
  Inventory,
  Mode,
  ModuleNode,
  TestLink,
} from './types.ts';

export interface ScanOptions extends WalkOptions {
  /** Force a mode instead of auto-detecting from the file mix. */
  mode?: Mode | 'auto';
  /** Max bytes to read per file when counting lines / parsing headings. */
  maxReadBytes?: number;
}

const TEXT_KINDS = new Set(['code', 'test', 'docs', 'config', 'other']);

function countLines(content: string): number {
  if (content === '') return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

/** Extract ATX (`#`) headings from a markdown/text document. */
function extractHeadings(content: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({
        level: match[1]!.length,
        title: match[2]!.trim(),
        line: i + 1,
      });
    }
  }
  return headings;
}

function moduleKeyFor(relPath: string): { name: string; path: string } {
  const idx = relPath.indexOf('/');
  if (idx === -1) return { name: 'root', path: '.' };
  const top = relPath.slice(0, idx);
  // For conventional source roots, group by the next segment down so that
  // `src/api/...` and `src/db/...` become distinct modules.
  if ((top === 'src' || top === 'lib' || top === 'app' || top === 'packages')) {
    const rest = relPath.slice(idx + 1);
    const idx2 = rest.indexOf('/');
    if (idx2 !== -1) {
      const second = rest.slice(0, idx2);
      return { name: `${top}/${second}`, path: `${top}/${second}` };
    }
  }
  return { name: top, path: top };
}

function basenameNoTestMarkers(file: string): string {
  let base = path.basename(file);
  base = base.replace(/\.(test|spec)(?=\.)/i, '');
  base = base.replace(/^test_/i, '');
  base = base.replace(/_test(?=\.)/i, '');
  const dot = base.indexOf('.');
  return (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
}

/** Heuristically link test files to the source files they likely exercise. */
function linkTests(testFiles: string[], codeFiles: string[]): TestLink[] {
  const codeByStem = new Map<string, string[]>();
  for (const code of codeFiles) {
    const stem = path.basename(code).replace(/\.[^.]+$/, '').toLowerCase();
    const list = codeByStem.get(stem) ?? [];
    list.push(code);
    codeByStem.set(stem, list);
  }
  const links: TestLink[] = [];
  for (const test of testFiles) {
    const stem = basenameNoTestMarkers(test);
    const targets = codeByStem.get(stem) ?? [];
    links.push({ test, targets: [...targets].sort() });
  }
  return links;
}

function detectMode(code: number, docs: number, test: number): Mode {
  if (code + test === 0 && docs > 0) return 'docs';
  // A repo with a couple of docs (README/CONTRIBUTING) is still a code repo.
  if (docs <= 2 || docs * 2 < code + test) return 'code';
  return 'mixed';
}

export function scan(root: string, options: ScanOptions = {}): Inventory {
  const absRoot = path.resolve(root);
  const stat = fs.statSync(absRoot);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${absRoot}`);
  }
  const maxReadBytes = options.maxReadBytes ?? 512 * 1024;

  const { files: relPaths } = walk(absRoot, options);

  const files: FileEntry[] = [];
  const docs: DocSection[] = [];
  const languages: Record<string, number> = {};
  const modules = new Map<string, ModuleNode>();
  const totals = {
    files: 0,
    code: 0,
    test: 0,
    docs: 0,
    config: 0,
    asset: 0,
    other: 0,
    loc: 0,
  };

  for (const rel of relPaths) {
    const abs = path.join(absRoot, rel);
    let size = 0;
    try {
      size = fs.statSync(abs).size;
    } catch {
      continue;
    }
    const kind = classify(rel);
    const language = detectLanguage(rel);

    let loc = 0;
    let content: string | null = null;
    if (TEXT_KINDS.has(kind) && size <= maxReadBytes) {
      try {
        content = fs.readFileSync(abs, 'utf8');
        loc = countLines(content);
      } catch {
        content = null;
      }
    }

    const entry: FileEntry = { path: rel, kind, language, size, loc };
    files.push(entry);

    totals.files++;
    totals.loc += loc;
    totals[kind]++;
    if (language) languages[language] = (languages[language] ?? 0) + 1;

    if (kind === 'docs' && content !== null) {
      const headings = extractHeadings(content);
      const h1 = headings.find((h) => h.level === 1);
      docs.push({
        path: rel,
        title: h1 ? h1.title : path.basename(rel),
        headings,
      });
    }

    const key = moduleKeyFor(rel);
    let mod = modules.get(key.path);
    if (!mod) {
      mod = {
        name: key.name,
        path: key.path,
        fileCount: 0,
        loc: 0,
        languages: {},
        codeFiles: [],
        testFiles: [],
        docFiles: [],
      };
      modules.set(key.path, mod);
    }
    mod.fileCount++;
    mod.loc += loc;
    if (language) mod.languages[language] = (mod.languages[language] ?? 0) + 1;
    if (kind === 'code') mod.codeFiles.push(rel);
    else if (kind === 'test') mod.testFiles.push(rel);
    else if (kind === 'docs') mod.docFiles.push(rel);
  }

  const allCode = files.filter((f) => f.kind === 'code').map((f) => f.path);
  const allTests = files.filter((f) => f.kind === 'test').map((f) => f.path);
  const tests = linkTests(allTests, allCode);

  const mode: Mode =
    !options.mode || options.mode === 'auto'
      ? detectMode(totals.code, totals.docs, totals.test)
      : options.mode;

  const moduleList = [...modules.values()].sort(
    (a, b) => b.loc - a.loc || a.path.localeCompare(b.path),
  );

  return {
    name: path.basename(absRoot),
    root: absRoot,
    generatedAt: new Date().toISOString(),
    mode,
    totals,
    languages,
    modules: moduleList,
    tests,
    docs: docs.sort((a, b) => a.path.localeCompare(b.path)),
    files,
  };
}
