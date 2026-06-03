import type { DocSection, Inventory } from './types.ts';

/**
 * Sanitize a label for use inside a Mermaid mindmap node. Mermaid mindmaps are
 * indentation-sensitive and choke on parentheses, brackets and other syntax
 * characters, so we strip them and collapse whitespace.
 */
export function mmLabel(raw: string, max = 48): string {
  let s = raw.replace(/[\r\n]+/g, ' ').replace(/["'`]/g, '');
  s = s.replace(/[()[\]{}<>#;]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s === '' ? '·' : s;
}

const INDENT = '  ';

function topLanguages(languages: Record<string, number>, limit = 4): string[] {
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([lang, count]) => `${lang} ${count}`);
}

/** Build a nested doc outline (chapters/sections) limited to H1/H2/H3. */
function docBranch(docs: DocSection[], lines: string[], depth: number): void {
  for (const doc of docs) {
    lines.push(`${INDENT.repeat(depth)}${mmLabel(doc.title)}`);
    const sub = doc.headings.filter((h) => h.level >= 2 && h.level <= 3);
    let lastH2Depth = depth + 1;
    for (const h of sub) {
      const d = h.level === 2 ? depth + 1 : depth + 2;
      lastH2Depth = h.level === 2 ? depth + 1 : lastH2Depth;
      lines.push(`${INDENT.repeat(d)}${mmLabel(h.title)}`);
    }
    void lastH2Depth;
  }
}

export interface MindmapOptions {
  /** Max modules to render before collapsing the rest into an "others" node. */
  maxModules?: number;
}

/** Render the inventory as a Mermaid `mindmap` diagram (without code fences). */
export function toMermaid(inv: Inventory, options: MindmapOptions = {}): string {
  const maxModules = options.maxModules ?? 14;
  const lines: string[] = ['mindmap'];
  const root = `${INDENT}root((${mmLabel(inv.name, 32)}))`;
  lines.push(root);

  if (inv.mode !== 'docs' && inv.modules.length > 0) {
    lines.push(`${INDENT.repeat(2)}Modules`);
    const shown = inv.modules.slice(0, maxModules);
    for (const mod of shown) {
      const langs = topLanguages(mod.languages, 2).join(', ');
      const suffix = langs ? ` [${langs}]` : '';
      lines.push(`${INDENT.repeat(3)}${mmLabel(`${mod.name}${suffix}`)}`);
    }
    if (inv.modules.length > shown.length) {
      lines.push(
        `${INDENT.repeat(3)}${mmLabel(`+${inv.modules.length - shown.length} more modules`)}`,
      );
    }
  }

  if (inv.totals.test > 0) {
    lines.push(`${INDENT.repeat(2)}Tests`);
    lines.push(`${INDENT.repeat(3)}${mmLabel(`${inv.totals.test} test files`)}`);
    const linked = inv.tests.filter((t) => t.targets.length > 0).length;
    lines.push(`${INDENT.repeat(3)}${mmLabel(`${linked} linked to sources`)}`);
  }

  if (inv.docs.length > 0) {
    lines.push(`${INDENT.repeat(2)}Docs`);
    // In docs mode, the documents *are* the map, so expand them fully.
    const docDepth = 3;
    const docsToShow = inv.mode === 'docs' ? inv.docs : inv.docs.slice(0, 6);
    docBranch(docsToShow, lines, docDepth);
  }

  if (Object.keys(inv.languages).length > 0 && inv.mode !== 'docs') {
    lines.push(`${INDENT.repeat(2)}Languages`);
    for (const label of topLanguages(inv.languages, 6)) {
      lines.push(`${INDENT.repeat(3)}${mmLabel(label)}`);
    }
  }

  return lines.join('\n');
}
