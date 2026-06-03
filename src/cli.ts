#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { scan, readTextContents } from './scan.ts';
import { buildInsights } from './insights.ts';
import { renderHtml } from './render-html.ts';
import { toMarkdown } from './report.ts';
import { toMermaid } from './mindmap.ts';
import type { Mode } from './types.ts';

interface CliArgs {
  mode: Mode | 'auto';
  json: boolean;
  stdout: boolean;
  help: boolean;
}

/** Fixed output directory, always written into the current working directory. */
const OUT_DIR = '.introspector';

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: 'auto',
    json: false,
    stdout: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-m':
      case '--mode': {
        const m = argv[++i];
        if (m === 'code' || m === 'docs' || m === 'mixed' || m === 'auto') args.mode = m;
        else throw new Error(`Invalid --mode: ${m} (expected code|docs|mixed|auto)`);
        break;
      }
      case '--json':
        args.json = true;
        break;
      case '--stdout':
        args.stdout = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

const HELP = `introspector — build a mindmap and guided tour of the current repo or document set

Always scans the current working directory and writes into ./${OUT_DIR}.
Re-running overwrites the artifacts in place.

Usage:
  introspector [options]

Options:
  -m, --mode <mode>    Force mode: code | docs | mixed | auto (default: auto)
      --json           Also write inventory.json
      --stdout         Print the Markdown report to stdout instead of writing files
  -h, --help           Show this help

Outputs (written into ./${OUT_DIR}):
  mindmap.md           Markdown report with an embedded Mermaid mindmap + guided tour
  mindmap.mmd          The raw Mermaid mindmap diagram
  insights.json        Scored insight-graph data (deterministic baseline)
  insights.html        Self-contained interactive insight graph
  inventory.json       Structured inventory (with --json)
`;

function main(): void {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    process.exit(2);
    return;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const target = process.cwd();

  const inv = scan(target, { mode: args.mode });
  const markdown = toMarkdown(inv);

  if (args.stdout) {
    process.stdout.write(markdown);
    return;
  }

  const outDir = path.join(target, OUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'mindmap.md'), markdown);
  fs.writeFileSync(path.join(outDir, 'mindmap.mmd'), toMermaid(inv) + '\n');
  // Insights are additive: the mindmap artifacts above are already on disk and
  // self-contained, so a failure here degrades gracefully with a warning rather
  // than aborting the run with a raw stack trace.
  try {
    const insights = buildInsights(inv, readTextContents(inv));
    fs.writeFileSync(path.join(outDir, 'insights.json'), JSON.stringify(insights, null, 2));
    fs.writeFileSync(path.join(outDir, 'insights.html'), renderHtml(insights));
  } catch (err) {
    process.stderr.write(
      `Warning: failed to generate the insight graph: ${(err as Error).message}\n`,
    );
  }
  if (args.json) {
    fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(inv, null, 2));
  }

  process.stdout.write(
    `Introspected ${inv.name}: ${inv.totals.files} files, ` +
      `${inv.modules.length} modules, ${inv.totals.test} tests.\n` +
      `Wrote ./${OUT_DIR}/mindmap.md and ./${OUT_DIR}/insights.html` +
      `${args.json ? `, ./${OUT_DIR}/inventory.json` : ''}.\n`,
  );
}

main();
