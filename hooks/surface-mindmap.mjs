#!/usr/bin/env node
/**
 * SessionStart hook for the introspector plugin.
 *
 * If the project already has an introspection artifact
 * (`.introspector/mindmap.md`), surface a short pointer to it as additional
 * context so Claude starts the session already oriented to the repo. If none
 * exists, the hook stays silent — it never blocks or nags.
 */
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const mapPath = path.join(cwd, '.introspector', 'mindmap.md');

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }),
  );
}

try {
  const stat = fs.statSync(mapPath);
  let body = fs.readFileSync(mapPath, 'utf8');
  // Keep the injected context bounded; point at the file for the full map.
  const MAX = 6000;
  if (body.length > MAX) body = body.slice(0, MAX) + '\n\n…(truncated; read the full file)…\n';
  const age = Math.round((Date.now() - stat.mtimeMs) / 86_400_000);
  emit(
    `This repository has an introspector mindmap at \`.introspector/mindmap.md\` ` +
      `(last updated ${age} day(s) ago). Use it for orientation; re-run the ` +
      `\`introspect\` skill if the code has changed substantially.\n\n${body}`,
  );
} catch {
  // No artifact yet: stay silent so the hook is non-intrusive.
}

process.exit(0);
