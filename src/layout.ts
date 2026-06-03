import type { Edge, LayoutPoint } from './types.ts';

export const VIEWPORT = { width: 1200, height: 800, margin: 60 };

interface LayoutInput {
  id: string;
  path: string;
}

/**
 * Top-level grouping key: first path segment, or "." for root files.
 * Deliberately shallow — unlike scan.ts moduleKeyFor, all of src/* shares one
 * column (src/api and src/db are not separated here).
 */
function groupKey(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

/**
 * Deterministic layout: nodes are grouped by their top-level directory, groups
 * are ordered by name, nodes within a group by id. Each group occupies a column
 * band; nodes stack vertically. No randomness or time — identical input
 * (in any order) yields byte-identical output.
 *
 * The `edges` argument is reserved for future force-directed refinement; the
 * current layout is purely structural.
 */
export function layout(nodes: LayoutInput[], _edges: Edge[]): LayoutPoint[] {
  if (nodes.length === 0) return [];

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const key = groupKey(n.path);
    const list = groups.get(key) ?? [];
    list.push(n.id);
    groups.set(key, list);
  }

  const groupNames = [...groups.keys()].sort();
  const cols = groupNames.length;
  const { width, height, margin } = VIEWPORT;
  const usableW = width - 2 * margin;
  const usableH = height - 2 * margin;
  const colStep = cols > 1 ? usableW / (cols - 1) : 0; // 0 is unused; the single-column path centers at width/2

  const points: LayoutPoint[] = [];
  groupNames.forEach((name, ci) => {
    const ids = (groups.get(name) ?? []).slice().sort();
    const rows = ids.length;
    const rowStep = rows > 1 ? usableH / (rows - 1) : 0;
    const x = cols > 1 ? margin + ci * colStep : width / 2;
    ids.forEach((id, ri) => {
      const y = rows > 1 ? margin + ri * rowStep : height / 2;
      points.push({ id, x: Math.round(x), y: Math.round(y) }); // round to whole-pixel grid for stable renderer output
    });
  });

  return points.sort((a, b) => a.id.localeCompare(b.id));
}
