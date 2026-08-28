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

// ---------------------------------------------------------------------------
// Part 2: data rendered from src/data/*.json.
//
// Part 1 above only ever looked at JsxText / string-literal JSX children —
// by construction it cannot see content that comes from `import x from
// '../data/whatever.json'` and gets rendered via `.map()`, because that text
// never appears as a literal in the .tsx source at all. That blind spot is
// exactly how a whole contributions/certifications section went missing
// while Part 1 reported 100% coverage: the checker was never looking at the
// data in the first place. This part closes that gap by reading each JSON
// file directly (independent of the generator and of Part 1) and checking
// every real string field lands in the page(s) that import it.
const DATA = path.join(ROOT, 'src', 'data');

// Which JSON file feeds which generated page(s) — matches the real `import
// ... from '../data/x.json'` lines in src/pages/*.tsx. weave-data.json is
// covered separately below (its 59-engineer scale needs its own summary
// rather than an exhaustive per-field check). social.json is intentionally
// excluded: it's rendered only by Header/Footer chrome, never by a page
// component, so it's out of scope for a per-page content check.
const JSON_PAGE_MAP = [
  { json: 'apps.json', pages: ['apps.md', 'index.md'] },
  { json: 'blogs.json', pages: ['blog.md', 'index.md'] },
  { json: 'projects.json', pages: ['projects.md', 'index.md'] },
  { json: 'contributions.json', pages: ['index.md'] },
];

// Fields that exist in the data but are genuinely not meant to be visible
// text (routing/DOM plumbing), judged per field, not blanket-excluded by
// length: `id`/`slug` are lookup keys, `icon` is a class-name-ish token,
// `content` is documented-empty on every blogs.json record (Flag A5 in the
// R2 inventory — the real prose lives in dedicated page components instead).
const SKIP_KEYS = new Set(['id', 'slug', 'icon', 'content', 'poster', 'src', 'images']);
const MIN_LEN_DATA = 6;

function collectJsonLeaves(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    if (value.length >= MIN_LEN_DATA) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectJsonLeaves(v, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k)) continue;
      collectJsonLeaves(v, out);
    }
  }
  return out;
}

// One documented exception: ContributionCard.tsx renders
// `contribution.techStack.slice(0, 3)` — the live site itself caps each
// card at 3 tags and shows a "+N" indicator for the rest (same pattern as
// ProjectCard). Matching that is fidelity to the real page, not a drop.
const JSON_ALLOWED_MISSING = {
  'contributions.json': ['CI/Build'],
};

let totalJsonMissing = 0;
for (const { json, pages: mdFiles } of JSON_PAGE_MAP) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, json), 'utf8'));
  const leaves = collectJsonLeaves(data);
  // A field only needs to show up in ONE of the pages that import this
  // file — e.g. a project's description is real content whether it's
  // /projects.md or the homepage carousel that shows it, and Home.tsx
  // legitimately doesn't repeat everything /projects.md has room for.
  const combined = mdFiles
    .map((f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8'))
    .join('\n');
  const combinedNorm = normOut(combined);
  const allowedJ = JSON_ALLOWED_MISSING[json] || [];
  const rawMissingJ = leaves.filter((leaf) => {
    if (/^https?:\/\//.test(leaf)) return !combined.includes(leaf);
    return !combinedNorm.includes(normOut(leaf));
  });
  const missing = rawMissingJ.filter((leaf) => !allowedJ.includes(leaf));
  const excusedJ = rawMissingJ.filter((leaf) => allowedJ.includes(leaf));
  if (excusedJ.length) {
    console.log(`${json}: ${excusedJ.length} excused (documented, see JSON_ALLOWED_MISSING): ${excusedJ.map((s) => `"${s}"`).join(', ')}`);
  }
  if (missing.length) {
    console.error(`\n${json} -> [${mdFiles.join(', ')}]: ${missing.length}/${leaves.length} field(s) not found in output:`);
    for (const m of missing) console.error(`  MISSING: "${m.slice(0, 100)}"`);
    totalJsonMissing += missing.length;
  } else {
    console.log(`${json} -> [${mdFiles.join(', ')}]: OK (${leaves.length} field(s), all present)`);
  }
}

// weave-data.json: checked as a targeted sample (real usernames + a metric
// name), not an exhaustive per-field walk across all 59 engineers — the
// take-home only ever surfaces the top-5-per-bucket subset by design (see
// gen-llms.mjs), so "every field of every engineer" isn't the right bar.
{
  const weaveData = JSON.parse(fs.readFileSync(path.join(DATA, 'weave-data.json'), 'utf8'));
  const weaveMd = fs.readFileSync(path.join(PUBLIC, 'take-homes/weave.md'), 'utf8');
  const defaultBucket = 'feature_owner';
  const expectedUsers = weaveData.top_by_bucket[defaultBucket] || [];
  const missingUsers = expectedUsers.filter((u) => !weaveMd.includes(u));
  if (missingUsers.length) {
    console.error(`\nweave-data.json -> [take-homes/weave.md]: missing top_by_bucket.${defaultBucket} usernames: ${missingUsers.join(', ')}`);
    totalJsonMissing += missingUsers.length;
  } else {
    console.log(`weave-data.json -> [take-homes/weave.md]: OK (${expectedUsers.length}/${expectedUsers.length} default-bucket usernames present)`);
  }
}

if (totalMissing > 0 || totalJsonMissing > 0) {
  console.error(`\nFAILED: ${totalMissing} literal text node(s) + ${totalJsonMissing} JSON-data field(s) missing.`);
  process.exit(1);
}
console.log('\nAll literal JSX text nodes and src/data/*.json fields accounted for across all in-scope pages.');
