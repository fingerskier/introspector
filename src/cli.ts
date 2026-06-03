#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { scan } from './scan.ts';
import { toMarkdown } from './report.ts';
import { toMermaid } from './mindmap.ts';
import type { Mode } from './types.ts';

interface CliArgs {
  target: string;
  outDir: string;
  mode: Mode | 'auto';
  json: boolean;
  stdout: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    target: '.',
    outDir: '.introspector',
    mode: 'auto',
    json: false,
    stdout: false,
    help: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-o':
      case '--out':
        args.outDir = argv[++i] ?? args.outDir;
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
        if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
        positionals.push(a);
    }
  }
  if (positionals[0]) args.target = positionals[0];
  return args;
}

const HELP = `introspector — build a mindmap and guided tour of a repo or document set

Usage:
  introspector [path] [options]

Arguments:
  path                 Directory to scan (default: current directory)

Options:
  -o, --out <dir>      Output directory (default: .introspector)
  -m, --mode <mode>    Force mode: code | docs | mixed | auto (default: auto)
      --json           Also write inventory.json
      --stdout         Print the Markdown report to stdout instead of writing files
  -h, --help           Show this help

Outputs (written into --out):
  mindmap.md           Markdown report with an embedded Mermaid mindmap + guided tour
  mindmap.mmd          The raw Mermaid mindmap diagram
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

  const target = path.resolve(args.target);
  if (!fs.existsSync(target)) {
    process.stderr.write(`Error: path does not exist: ${target}\n`);
    process.exit(1);
    return;
  }

  const inv = scan(target, { mode: args.mode });
  const markdown = toMarkdown(inv);

  if (args.stdout) {
    process.stdout.write(markdown);
    return;
  }

  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'mindmap.md'), markdown);
  fs.writeFileSync(path.join(outDir, 'mindmap.mmd'), toMermaid(inv) + '\n');
  if (args.json) {
    fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(inv, null, 2));
  }

  const rel = path.relative(process.cwd(), outDir) || '.';
  process.stdout.write(
    `Introspected ${inv.name} (${inv.mode} mode): ${inv.totals.files} files, ` +
      `${inv.modules.length} modules, ${inv.totals.test} tests.\n` +
      `Wrote ${rel}/mindmap.md${args.json ? `, ${rel}/inventory.json` : ''}.\n`,
  );
}

main();
