import { extractEdges } from './edges.ts';
import { scoreNodes } from './score.ts';
import { layout } from './layout.ts';
import type { InsightNode, Insights, Inventory } from './types.ts';

/**
 * Assemble the full Insights object from a scanned inventory and the text
 * contents of its files. Deterministic: timestamp mirrors the inventory and
 * all coordinates come from the stable layout pass. AI fields stay null/empty.
 */
export function buildInsights(inventory: Inventory, contents: Map<string, string>): Insights {
  const edges = extractEdges(inventory, contents);
  const scored = scoreNodes(inventory, edges, contents);
  const points = layout(
    scored.map((n) => ({ id: n.id, path: n.path })),
    edges,
  );
  const coordById = new Map(points.map((p) => [p.id, p]));

  const nodes: InsightNode[] = scored.map((n) => {
    const pt = coordById.get(n.id);
    // layout() emits exactly one point per node id, so pt is always defined.
    // Guard loudly rather than silently stacking nodes at the origin.
    if (!pt) throw new Error(`layout produced no coordinate for node ${n.id}`);
    return {
      id: n.id,
      kind: n.kind,
      path: n.path,
      layout: { x: pt.x, y: pt.y },
      scores: n.scores,
      flags: n.flags,
      notes: [],
    };
  });

  return {
    generatedAt: inventory.generatedAt,
    nodes,
    edges,
    meta: { nodeCount: nodes.length, edgeCount: edges.length, aiEnriched: false },
  };
}
