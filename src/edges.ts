import path from 'node:path';
import type { Edge, Inventory } from './types.ts';

/** Extensions tried (in order) when resolving an extensionless specifier. */
const RESOLVE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py'];
const INDEX_BASES = ['index', '__init__', 'mod'];

/** Normalize a joined path to forward slashes, no leading "./". */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Resolve a relative module specifier from `fromFile` to an in-repo file path,
 * or null if it points outside the known file set.
 */
function resolveRelative(fromFile: string, spec: string, fileSet: Set<string>): string | null {
  const baseDir = path.posix.dirname(norm(fromFile));
  const joined = norm(path.posix.normalize(path.posix.join(baseDir, spec)));
  if (joined.startsWith('..')) return null;
  if (fileSet.has(joined)) return joined;
  for (const ext of RESOLVE_EXTS) {
    if (fileSet.has(joined + ext)) return joined + ext;
  }
  for (const base of INDEX_BASES) {
    for (const ext of RESOLVE_EXTS) {
      const candidate = norm(`${joined}/${base}${ext}`);
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}

/** Resolve a dotted Python module ("pkg.sub.c") against the repo root. */
function resolvePython(spec: string, fileSet: Set<string>): string | null {
  const rel = spec.replace(/^\.+/, '').split('.').join('/');
  if (rel === '') return null;
  if (fileSet.has(`${rel}.py`)) return `${rel}.py`;
  if (fileSet.has(`${rel}/__init__.py`)) return `${rel}/__init__.py`;
  return null;
}

const JS_IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
const JS_BARE_IMPORT_RE = /import\s*['"]([^'"]+)['"]/g;
const JS_REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_FROM_RE = /^\s*from\s+([.\w]+)\s+import\s/gm;
const PY_IMPORT_RE = /^\s*import\s+([.\w]+)/gm;
const MD_LINK_RE = /\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g;
const INDEX_FILE_RE = /(^|\/)(index|readme|__init__|mod)\.[a-z0-9]+$/i;

function codeEdges(
  file: string,
  content: string,
  fileSet: Set<string>,
  isPython: boolean,
): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  const push = (to: string | null): void => {
    if (to && to !== file && !seen.has(to)) {
      seen.add(to);
      out.push({ from: file, to, type: 'import' });
    }
  };
  if (isPython) {
    for (const re of [PY_FROM_RE, PY_IMPORT_RE]) {
      for (const m of content.matchAll(re)) push(resolvePython(m[1]!, fileSet));
    }
  } else {
    for (const re of [JS_IMPORT_RE, JS_BARE_IMPORT_RE, JS_REQUIRE_RE]) {
      for (const m of content.matchAll(re)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) push(resolveRelative(file, spec, fileSet));
      }
    }
  }
  return out;
}

function linkEdges(file: string, content: string, fileSet: Set<string>): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(MD_LINK_RE)) {
    let spec = m[1]!;
    if (/^[a-z]+:/i.test(spec) || spec.startsWith('#') || spec.startsWith('mailto:')) continue;
    spec = spec.split('#')[0]!.split('?')[0]!;
    if (spec === '') continue;
    const to = resolveRelative(file, spec, fileSet);
    if (to && to !== file && !seen.has(to)) {
      seen.add(to);
      out.push({ from: file, to, type: 'link' });
    }
  }
  return out;
}

function flowEdges(docPaths: string[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < docPaths.length - 1; i++) {
    out.push({ from: docPaths[i]!, to: docPaths[i + 1]!, type: 'flow' });
  }
  return out;
}

function containsEdges(files: string[]): Edge[] {
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = path.posix.dirname(norm(f));
    const list = byDir.get(dir) ?? [];
    list.push(f);
    byDir.set(dir, list);
  }
  const out: Edge[] = [];
  for (const siblings of byDir.values()) {
    const index = siblings.find((s) => INDEX_FILE_RE.test(s));
    if (!index) continue;
    for (const sib of siblings) {
      if (sib !== index) out.push({ from: index, to: sib, type: 'contains' });
    }
  }
  return out;
}

/**
 * Extract typed graph edges from an inventory plus a map of file text contents.
 * Best-effort and total: unknown languages and missing content yield no edges
 * for that file, never an exception.
 */
export function extractEdges(inventory: Inventory, contents: Map<string, string>): Edge[] {
  const fileSet = new Set(inventory.files.map((f) => f.path));
  const edges: Edge[] = [];

  for (const entry of inventory.files) {
    if (entry.kind !== 'code' && entry.kind !== 'test') continue;
    const content = contents.get(entry.path);
    if (!content) continue;
    const isPython = entry.path.endsWith('.py');
    edges.push(...codeEdges(entry.path, content, fileSet, isPython));
  }

  for (const link of inventory.tests) {
    for (const target of link.targets) {
      edges.push({ from: link.test, to: target, type: 'tests' });
    }
  }

  for (const entry of inventory.files) {
    if (entry.kind !== 'docs') continue;
    const content = contents.get(entry.path);
    if (content) edges.push(...linkEdges(entry.path, content, fileSet));
  }

  edges.push(...flowEdges(inventory.docs.map((d) => d.path)));
  edges.push(...containsEdges(inventory.files.map((f) => f.path)));

  return edges;
}
