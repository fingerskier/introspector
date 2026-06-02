import path from 'node:path';
import type { FileKind } from './types.ts';

/** Maps file extensions to human-friendly language labels. */
const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.scala': 'Scala',
  '.clj': 'Clojure',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.hs': 'Haskell',
  '.lua': 'Lua',
  '.dart': 'Dart',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.sql': 'SQL',
  '.r': 'R',
  '.m': 'Objective-C',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.sass': 'CSS',
  '.less': 'CSS',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.md': 'Markdown',
  '.mdx': 'Markdown',
  '.rst': 'reStructuredText',
  '.adoc': 'AsciiDoc',
  '.txt': 'Text',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.toml': 'TOML',
  '.ini': 'INI',
  '.xml': 'XML',
};

const DOC_EXTS = new Set(['.md', '.mdx', '.rst', '.adoc', '.txt']);

const CONFIG_EXTS = new Set([
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.lock',
  '.xml',
]);

const ASSET_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.wav',
  '.zip',
  '.gz',
  '.tar',
  '.bin',
  '.wasm',
]);

const CODE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.cs',
  '.php',
  '.scala',
  '.clj',
  '.ex',
  '.exs',
  '.erl',
  '.hs',
  '.lua',
  '.dart',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.r',
  '.m',
  '.vue',
  '.svelte',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
]);

/** Configuration files recognised by exact (lowercased) name. */
const CONFIG_NAMES = new Set([
  'dockerfile',
  'makefile',
  'rakefile',
  'gemfile',
  'procfile',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.dockerignore',
  '.prettierrc',
  '.eslintrc',
]);

export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext in LANGUAGE_BY_EXT) return LANGUAGE_BY_EXT[ext] ?? null;
  return null;
}

const TEST_NAME_RE =
  /(\.|_)(test|spec)\.[a-z0-9]+$|(^|\.)test_[^/]*\.[a-z0-9]+$|_test\.[a-z0-9]+$/i;

const TEST_DIR_RE = /(^|\/)(tests?|__tests__|spec|specs|e2e)(\/|$)/i;

/** True when a file looks like an automated test by name or location. */
export function isTestFile(relPath: string): boolean {
  const base = path.basename(relPath).toLowerCase();
  if (base.startsWith('test_')) return true;
  if (TEST_NAME_RE.test(base)) return true;
  if (TEST_DIR_RE.test(relPath)) return true;
  return false;
}

export function classify(relPath: string): FileKind {
  const base = path.basename(relPath).toLowerCase();
  const ext = path.extname(relPath).toLowerCase();

  if (ASSET_EXTS.has(ext)) return 'asset';

  const inDocsTree = /(^|\/)(docs?|documentation)(\/|$)/i.test(relPath);
  if (DOC_EXTS.has(ext)) return 'docs';
  if (inDocsTree && CODE_EXTS.has(ext) === false && CONFIG_EXTS.has(ext) === false) {
    return 'docs';
  }

  // Tests are classified before generic code so they group separately.
  if (CODE_EXTS.has(ext) && isTestFile(relPath)) return 'test';

  if (CODE_EXTS.has(ext)) return 'code';

  if (CONFIG_NAMES.has(base) || base.startsWith('dockerfile.')) return 'config';
  if (CONFIG_EXTS.has(ext)) return 'config';

  return 'other';
}
