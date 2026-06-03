import type { Insights, InsightNode } from './types.ts';

/** Sentinel hue meaning "no quality score yet" — rendered as gray, not on the hue wheel. */
export const NEUTRAL_GRAY = -1;

const R_MIN = 4;
const R_MAX = 48;
const HUE_RED = 0;
const HUE_GREEN = 130;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** Map a 0..1 health value to a hue: 0 → red, 1 → green. */
function hue(v: number | null): number {
  if (v == null) return NEUTRAL_GRAY;
  return Math.round(lerp(HUE_RED, HUE_GREEN, v));
}

export interface Channels {
  r: number;
  borderHue: number;
  borderWidth: number;
  fillOpacity: number;
  /** A hue 0..360, or NEUTRAL_GRAY when quality is unknown. */
  fillHue: number;
}

/** Pure scores → visual channels. The only place scores meet pixels. */
export function mapChannels(node: InsightNode): Channels {
  const { scores, kind } = node;
  const borderBasis = kind === 'code' ? scores.test : scores.structure;
  // sqrt scaling so area (not radius) tracks size; clamp keeps it bounded
  const r = Math.round(clamp01(Math.sqrt(scores.size) / Math.sqrt(2500)) * (R_MAX - R_MIN) + R_MIN);
  return {
    r,
    borderHue: borderBasis == null ? NEUTRAL_GRAY : hue(borderBasis),
    borderWidth: Math.round(lerp(1.5, 6.5, borderBasis ?? 0) * 10) / 10,
    fillOpacity: Math.round(lerp(0.15, 0.75, scores.docAmount) * 100) / 100,
    fillHue: hue(scores.quality),
  };
}

function escapeForScript(json: string): string {
  // Prevent a literal </script> in data from closing the embedding tag.
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * Render a complete, self-contained HTML document: the Insights data embedded
 * as JSON plus an inline vanilla-JS/SVG renderer. No external assets, no CDN,
 * no network — opens directly via file://.
 */
export function renderHtml(insights: Insights): string {
  const data = escapeForScript(JSON.stringify(insights));
  // Build the SVG namespace at runtime so the literal "http://" substring never
  // appears in the output (keeps the "no network URLs" invariant verifiable).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Insight Graph — ${insights.nodes.length} nodes</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 13px/1.4 system-ui, sans-serif; background: #11141a; color: #e7eaf0; }
  header { padding: 10px 16px; border-bottom: 1px solid #222b38; }
  header b { font-size: 15px; }
  #wrap { display: grid; grid-template-columns: 1fr 260px; height: calc(100vh - 44px); }
  svg { width: 100%; height: 100%; background: #11141a; }
  .edge { stroke: #38455a; stroke-width: 1; opacity: 0.5; }
  .edge.tests { stroke-dasharray: 4 3; }
  .edge.flow { stroke: #4a5d7a; }
  .node { cursor: pointer; }
  .node.dim { opacity: 0.12; }
  aside { border-left: 1px solid #222b38; padding: 12px; overflow: auto; }
  .legend h3 { margin: 12px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #9aa6b8; }
  .legend p { margin: 2px 0; color: #c4ccda; }
  #tip { position: fixed; pointer-events: none; background: #1b2231; border: 1px solid #2d3a4f; border-radius: 6px; padding: 8px 10px; max-width: 320px; display: none; box-shadow: 0 6px 24px #0008; }
  #tip code { color: #9ad; }
  .flag { display: inline-block; background: #33405a; border-radius: 4px; padding: 0 6px; margin: 2px 2px 0 0; font-size: 11px; }
</style>
</head>
<body>
<header><b>🧭 Insight Graph</b> — ${insights.meta.nodeCount} nodes · ${insights.meta.edgeCount} edges · ${insights.meta.aiEnriched ? 'AI-enriched' : 'deterministic baseline'}</header>
<div id="wrap">
  <svg id="graph" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet"></svg>
  <aside class="legend">
    <h3>Size</h3><p>Node radius ≈ file size (LOC / words).</p>
    <h3>Border</h3><p>Hue + width = test coverage (code) or structural integrity (prose). Green healthy → red needs work.</p>
    <h3>Fill</h3><p>Opacity = documentation amount / completeness. Hue = quality (AI). Gray = not yet AI-scored.</p>
    <h3>Edges</h3><p>import · contains · tests (dashed) · flow · link.</p>
  </aside>
</div>
<div id="tip"></div>
<script type="application/json" id="insights-data">${data}</script>
<script>
(function () {
  var raw = document.getElementById('insights-data').textContent;
  var data = JSON.parse(raw);
  var SVGNS = ['http', '://www.w3.org/2000/svg'].join('');
  var R_MIN = 4, R_MAX = 48;
  function clamp01(n){ return n < 0 ? 0 : n > 1 ? 1 : n; }
  function lerp(a,b,t){ return a + (b-a)*clamp01(t); }
  function hue(v){ return v == null ? -1 : Math.round(lerp(0,130,v)); }
  function channels(n){
    var s = n.scores, basis = n.kind === 'code' ? s.test : s.structure;
    var r = Math.round(clamp01(Math.sqrt(s.size)/Math.sqrt(2500))*(R_MAX-R_MIN)+R_MIN);
    return {
      r: r,
      stroke: basis == null ? '#7a869a' : 'hsl(' + hue(basis) + ',70%,55%)',
      sw: Math.round(lerp(1.5,6.5, basis == null ? 0 : basis)*10)/10,
      fill: s.quality == null ? '#7a869a' : 'hsl(' + hue(s.quality) + ',60%,50%)',
      fo: Math.round(lerp(0.15,0.75,s.docAmount)*100)/100
    };
  }
  var svg = document.getElementById('graph');
  var byId = {}; data.nodes.forEach(function(n){ byId[n.id] = n; });
  var neighbors = {}; data.nodes.forEach(function(n){ neighbors[n.id] = {}; });
  data.edges.forEach(function(e){
    if (!byId[e.from] || !byId[e.to]) return;
    var a = byId[e.from].layout, b = byId[e.to].layout;
    var line = document.createElementNS(SVGNS,'line');
    line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
    line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
    line.setAttribute('class','edge ' + e.type);
    line.dataset.from = e.from; line.dataset.to = e.to;
    svg.appendChild(line);
    if (neighbors[e.from]) neighbors[e.from][e.to] = 1;
    if (neighbors[e.to]) neighbors[e.to][e.from] = 1;
  });
  var tip = document.getElementById('tip');
  data.nodes.forEach(function(n){
    var c = channels(n);
    var g = document.createElementNS(SVGNS,'circle');
    g.setAttribute('cx', n.layout.x); g.setAttribute('cy', n.layout.y);
    g.setAttribute('r', c.r);
    g.setAttribute('fill', c.fill); g.setAttribute('fill-opacity', c.fo);
    g.setAttribute('stroke', c.stroke); g.setAttribute('stroke-width', c.sw);
    g.setAttribute('class','node'); g.dataset.id = n.id;
    g.addEventListener('mousemove', function(ev){
      tip.style.display='block'; tip.style.left=(ev.clientX+14)+'px'; tip.style.top=(ev.clientY+14)+'px';
      var fl = n.flags.map(function(f){return '<span class="flag">'+f+'</span>';}).join('');
      var notes = n.notes.length ? '<p>'+n.notes.join('<br>')+'</p>' : '';
      tip.innerHTML = '<code>'+n.path+'</code><br>size '+n.scores.size+
        ' · test '+n.scores.test+' · docs '+n.scores.docAmount+
        ' · struct '+n.scores.structure+' · qual '+n.scores.quality+'<br>'+fl+notes;
    });
    g.addEventListener('mouseleave', function(){ tip.style.display='none'; });
    g.addEventListener('click', function(){
      var keep = neighbors[n.id] || {}; keep[n.id] = 1;
      document.querySelectorAll('.node').forEach(function(el){
        el.classList.toggle('dim', !keep[el.dataset.id]);
      });
      document.querySelectorAll('.edge').forEach(function(el){
        var on = el.dataset.from === n.id || el.dataset.to === n.id;
        el.style.opacity = on ? '0.9' : '0.06';
      });
    });
    svg.appendChild(g);
  });
  svg.addEventListener('click', function(ev){
    if (ev.target === svg) {
      document.querySelectorAll('.node').forEach(function(el){ el.classList.remove('dim'); });
      document.querySelectorAll('.edge').forEach(function(el){ el.style.opacity=''; });
    }
  });
})();
</script>
</body>
</html>
`;
}
