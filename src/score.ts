import path from 'node:path';
import type { Edge, Inventory, NodeScores, ScoredNode } from './types.ts';

export const OVERSIZED_LOC = 400;
export const STUB_WORDS = 50;
export const PROSE_TARGET_WORDS = 300;

const STUB_MARKER_RE = /\b(todo|tbd|fixme|placeholder|coming soon|wip)\b/i;
const COMMENT_LINE_RE = /^\s*(\/\/|#|\*|\/\*)/;
/** Markdown link target capture: drops fragments/queries via the char class. */
const MD_LINK_TARGET_RE = /\[[^\]]*\]\(\s*([^)\s#?]+)[^)]*\)/g;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function countWords(content: string): number {
  const m = content.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function commentRatio(content: string): number {
  const lines = content.split(/\r?\n/);
  let comments = 0;
  for (const line of lines) if (COMMENT_LINE_RE.test(line)) comments++;
  return comments / lines.length;
}

/**
 * True if a markdown link `spec` from `fromFile` resolves to one of the
 * already-resolved `link` edge targets. The spec is normalized to a canonical
 * repo-relative path (mirroring edges.ts resolution) so that `./`, `../`, and
 * nested-directory links all compare correctly.
 */
function isResolvedLink(fromFile: string, spec: string, resolved: Set<string>): boolean {
  const baseDir = path.posix.dirname(fromFile);
  const norm = path.posix.normalize(path.posix.join(baseDir, spec)).replace(/^\.\//, '');
  return resolved.has(norm);
}

/**
 * Deterministic, side-effect-free scoring of every code/doc file in the
 * inventory. AI-only fields (quality, and code `structure`) are left null.
 */
export function scoreNodes(
  inventory: Inventory,
  edges: Edge[],
  contents: Map<string, string>,
): ScoredNode[] {
  const testedSources = new Set(
    edges.filter((e) => e.type === 'tests').map((e) => e.to),
  );
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.from);
    connected.add(e.to);
  }

  const nodes: ScoredNode[] = [];

  for (const entry of inventory.files) {
    if (entry.kind !== 'code' && entry.kind !== 'docs') continue;
    const kind: 'code' | 'doc' = entry.kind === 'code' ? 'code' : 'doc';
    const content = contents.get(entry.path) ?? '';
    const flags: string[] = [];
    const scores: NodeScores = {
      size: 0,
      test: null,
      docAmount: 0,
      structure: null,
      quality: null,
    };

    if (kind === 'code') {
      scores.size = entry.loc;
      scores.test = testedSources.has(entry.path) ? 1 : 0;
      // ~20% comment density maps to a full docAmount score.
      scores.docAmount = clamp01(commentRatio(content) * 5);
      if (scores.test === 0) flags.push('untested');
      if (entry.loc > OVERSIZED_LOC) flags.push('oversized');
    } else {
      const words = countWords(content);
      scores.size = words;
      const isStub = words < STUB_WORDS || STUB_MARKER_RE.test(content);
      scores.docAmount = isStub ? 0 : clamp01(words / PROSE_TARGET_WORDS);
      if (isStub) flags.push('stub');

      // Structure = link integrity. A markdown link whose target produced no
      // resolved `link` edge from this file is treated as broken.
      const resolved = new Set(
        edges.filter((e) => e.from === entry.path && e.type === 'link').map((e) => e.to),
      );
      // Heuristic: also scans links inside fenced code blocks — acceptable by design.
      const internal = [...content.matchAll(MD_LINK_TARGET_RE)]
        .map((m) => m[1]!)
        .filter((t) => !/^[a-z]+:/i.test(t) && !t.startsWith('#'));
      const brokenCount = internal.filter((t) => !isResolvedLink(entry.path, t, resolved)).length;
      if (brokenCount > 0) flags.push('broken-link');
      scores.structure = clamp01(1 - 0.25 * brokenCount);
    }

    if (!connected.has(entry.path)) flags.push('orphan');

    nodes.push({ id: entry.path, kind, path: entry.path, scores, flags });
  }

  return nodes;
}
