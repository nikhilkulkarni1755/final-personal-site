// Independent safety net, run after scripts/gen-llms.mjs: parses each source
// page fresh (not through the interpretation engine at all) and collects
// every literal text-bearing JSX leaf — JsxText nodes and string-literal JSX
// expression children — then checks each one is present in that page's
// generated markdown. This catches drops the interpretation engine's own
// runtime check (component children that resolve to nothing) can't see,
// e.g. a literal string that silently lands in the wrong branch of a
// tag-resolution switch. It intentionally only checks LITERAL text (not
// data pulled from arrays/JSON/hooks), since those are exactly the two
// things the generator is honestly allowed to drop when unresolvable —
// runtime-only values (documented per-page) and deliberately-excluded
// interactive-diagram chrome — and a literal string in JSX is never either.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'pages');
const PUBLIC = path.join(ROOT, 'public');

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}
function norm(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

// Pages known to pull class-name-ish literal strings into places that read
// as JsxText because of how a handful of components format labels (e.g. a
// unicode bullet char, a single emoji) — anything this short is noise, not
// content, so it's excluded from the check rather than padding it with
// exceptions per page.
const MIN_LEN = 12;

function collectLiteralLeaves(absFile) {
  const text = fs.readFileSync(absFile, 'utf8');
  const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const leaves = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const t = norm(node.text);
      if (t.length >= MIN_LEN) leaves.push(t);
    } else if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression)) {
      const t = norm(node.expression.text);
      if (t.length >= MIN_LEN) leaves.push(t);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leaves;
}

function normOut(s) {
  return s.replace(/\\\|/g, '|').replace(/[*_`>#\[\]()-]/g, '').replace(/\s+/g, ' ').trim();
}

const PAGES = [
  ['Home.tsx', 'index.md'],
  ['About.tsx', 'about.md'],
  ['Projects.tsx', 'projects.md'],
  ['Blog.tsx', 'blog.md'],
  ['DockerSecretsPost.tsx', 'blog/docker-secrets-injection.md'],
  ['LinkedinAgentPost.tsx', 'blog/linkedin-agent.md'],
  ['MatmulTutorial.tsx', 'blog/matmul-to-ai.md'],
  ['Apps.tsx', 'apps.md'],
  ['Privacy.tsx', 'privacy-policy.md'],
  ['FireworksAI.tsx', 'spearfishing/fireworks-ai.md'],
  ['WeaveTakeHome.tsx', 'take-homes/weave.md'],
];

// Two exceptions, both judged and documented rather than silently allowed:
// the error-state heading only renders when the capture JSON fails to load
// (findReturnJsx picks the real content return, which is correct — the
// error text is not content); and the mode-toggle UI is gated on
// `canCompare`, derived from a runtime fetch() this static engine cannot
// see (the same documented limitation as the page's other runtime-fetched
// numbers). Neither is a fact about the project that an agent would miss.
const ALLOWED_MISSING = {
  'FireworksAI.tsx': [
    'Could not load the capture data',
    'serving mode:',
    'same rig, same model — only the split changes',
  ],
};

let totalMissing = 0;
for (const [srcFile, mdFile] of PAGES) {
  const leaves = collectLiteralLeaves(path.join(SRC, srcFile));
  const mdRaw = fs.readFileSync(path.join(PUBLIC, mdFile), 'utf8');
  const mdNorm = normOut(mdRaw);
  const rawMissing = leaves.filter((leaf) => !mdNorm.includes(normOut(leaf)));
  const allowed = ALLOWED_MISSING[srcFile] || [];
  const missing = rawMissing.filter((leaf) => !allowed.some((a) => normOut(a) === normOut(leaf)));
  const excused = rawMissing.filter((leaf) => allowed.some((a) => normOut(a) === normOut(leaf)));
  if (excused.length) {
    console.log(`${srcFile}: ${excused.length} excused (documented, see ALLOWED_MISSING): ${excused.map((s) => `"${s}"`).join(', ')}`);
  }
  if (missing.length) {
    console.error(`\n${srcFile} -> ${mdFile}: ${missing.length}/${leaves.length} literal text node(s) not found in output:`);
    for (const m of missing) console.error(`  MISSING: "${m.slice(0, 100)}"`);
    totalMissing += missing.length;
  } else {
    console.log(`${srcFile} -> ${mdFile}: OK (${leaves.length} literal text nodes, all present)`);
  }
}

if (totalMissing > 0) {
  console.error(`\nFAILED: ${totalMissing} literal text node(s) missing across all pages.`);
  process.exit(1);
}
console.log('\nAll literal JSX text nodes accounted for across all in-scope pages.');
