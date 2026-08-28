// Which entrypoints can transitively reach the two files that can post,
// send, or read a credential? Static import-graph walk over finds/**.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..');
const all = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = resolve(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) all.push(p); } })(ROOT);
const importsOf = new Map();
for (const f of all) {
  const src = readFileSync(f, 'utf8');
  const deps = [...src.matchAll(/from\s+'(\.[^']+)'|import\('(\.[^']+)'\)/g)].map((m) => resolve(dirname(f), m[1] ?? m[2]));
  importsOf.set(f, deps.filter((d) => all.includes(d)));
}
function reaches(from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false; seen.add(from);
  return (importsOf.get(from) ?? []).some((d) => reaches(d, target, seen));
}
const targets = {
  'comment/peerlistClient.ts (POSTs with Nikhil\'s cookie)': resolve(ROOT, 'comment/peerlistClient.ts'),
  'comment/config.ts (reads the cookie jar)': resolve(ROOT, 'comment/config.ts'),
  'email/transport.ts (real SMTP)': resolve(ROOT, 'email/transport.ts'),
  'sources/peerlist.ts (spoofed Chrome UA)': resolve(ROOT, 'sources/peerlist.ts'),
};
const entrypoints = all.filter((f) => /\/(run-|cli|daily|dry-run|postComment|send|poll|ask)\b|\/(daily|pipeline)\.ts$/.test(f));
for (const [label, t] of Object.entries(targets)) {
  console.log(`\ncan reach ${label}:`);
  for (const e of entrypoints) if (reaches(e, t)) console.log('   ', relative(ROOT, e));
}
