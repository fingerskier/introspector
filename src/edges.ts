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

  return edges;
}
