import fs from 'node:fs';
import path from 'node:path';

/** Directories that are never worth scanning for a conceptual map. */
const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  '.turbo',
  'target',
  'vendor',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  '.gradle',
  '.terraform',
  '.introspector',
]);

/**
 * Minimal `.gitignore`-style matcher. It supports the common cases — bare
 * names, directory names, and `*.ext` globs — which is plenty for deciding
 * what to skip when building a conceptual overview. It is intentionally not a
 * full gitignore implementation.
 */
export class Ignorer {
  private exact = new Set<string>();
  private extensions = new Set<string>();
  private suffixes: string[] = [];

  add(pattern: string): void {
    let p = pattern.trim();
    if (p === '' || p.startsWith('#')) return;
    if (p.startsWith('!')) return; // negation unsupported in this MVP
    p = p.replace(/^\//, '').replace(/\/$/, '');
    if (p === '') return;
    if (p.startsWith('*.') && !p.slice(2).includes('/') && !p.slice(2).includes('*')) {
      this.extensions.add(p.slice(1).toLowerCase()); // ".ext"
      return;
    }
    if (p.includes('*') || p.includes('?') || p.includes('[')) {
      // Unsupported complex glob — fall back to a loose suffix match.
      const cleaned = p.replace(/[*?[\]]/g, '');
      if (cleaned) this.suffixes.push(cleaned.toLowerCase());
      return;
    }
    this.exact.add(p);
  }

  addFromFile(file: string): void {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const line of content.split(/\r?\n/)) this.add(line);
  }

  /** Whether a path (relative, forward-slashed) or its basename is ignored. */
  ignores(relPath: string, name: string): boolean {
    if (this.exact.has(name) || this.exact.has(relPath)) return true;
    const lower = name.toLowerCase();
    for (const ext of this.extensions) {
      if (lower.endsWith(ext)) return true;
    }
    const relLower = relPath.toLowerCase();
    for (const suffix of this.suffixes) {
      if (relLower.includes(suffix)) return true;
    }
    return false;
  }
}

export interface WalkResult {
  /** File paths relative to root, forward-slashed. */
  files: string[];
}

export interface WalkOptions {
  /** Respect a top-level `.gitignore` if present. Defaults to true. */
  useGitignore?: boolean;
  /** Maximum directory depth to descend. Defaults to 12. */
  maxDepth?: number;
}

/** Recursively collect files under `root`, skipping ignored directories. */
export function walk(root: string, options: WalkOptions = {}): WalkResult {
  const { useGitignore = true, maxDepth = 12 } = options;
  const ignorer = new Ignorer();
  if (useGitignore) ignorer.addFromFile(path.join(root, '.gitignore'));

  const files: string[] = [];

  const recurse = (dir: string, rel: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const relPath = rel === '' ? name : `${rel}/${name}`;

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(name)) continue;
        if (ignorer.ignores(relPath, name)) continue;
        recurse(path.join(dir, name), relPath, depth + 1);
      } else if (entry.isFile()) {
        if (ignorer.ignores(relPath, name)) continue;
        files.push(relPath);
      }
    }
  };

  recurse(root, '', 0);
  files.sort();
  return { files };
}
