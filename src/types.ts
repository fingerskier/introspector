/**
 * Shared types for the introspector inventory model.
 *
 * The inventory is the deterministic, machine-readable description of a target
 * directory that the scanner produces. Both the Mermaid mindmap and the guided
 * tour are derived from it, and the Claude skill enriches it with semantics.
 */

export type FileKind = 'code' | 'test' | 'docs' | 'config' | 'asset' | 'other';

export type Mode = 'code' | 'docs' | 'mixed';

export interface FileEntry {
  /** Path relative to the scanned root, using forward slashes. */
  path: string;
  kind: FileKind;
  /** Human-friendly language label, or null when unknown/not text. */
  language: string | null;
  /** Size in bytes. */
  size: number;
  /** Approximate line count (0 for binary/asset files). */
  loc: number;
}

export interface DocHeading {
  level: number;
  title: string;
  /** 1-based line number within the document. */
  line: number;
}

export interface DocSection {
  path: string;
  /** Title of the document (first H1, else the file name). */
  title: string;
  headings: DocHeading[];
}

export interface ModuleNode {
  /** Display name of the module (top-level path segment, or "root"). */
  name: string;
  /** Path of the module relative to the root ("." for the root module). */
  path: string;
  fileCount: number;
  loc: number;
  /** Language -> file count within this module. */
  languages: Record<string, number>;
  codeFiles: string[];
  testFiles: string[];
  docFiles: string[];
}

export interface TestLink {
  /** The test file. */
  test: string;
  /** Best-guess source files the test exercises. */
  targets: string[];
}

export interface InventoryTotals {
  files: number;
  code: number;
  test: number;
  docs: number;
  config: number;
  asset: number;
  other: number;
  loc: number;
}

export interface Inventory {
  /** Display name for the scanned root (its directory name). */
  name: string;
  /** Absolute path that was scanned. */
  root: string;
  /** ISO timestamp of when the scan ran. */
  generatedAt: string;
  mode: Mode;
  totals: InventoryTotals;
  /** Language -> file count across the whole tree. */
  languages: Record<string, number>;
  modules: ModuleNode[];
  tests: TestLink[];
  docs: DocSection[];
  files: FileEntry[];
}
