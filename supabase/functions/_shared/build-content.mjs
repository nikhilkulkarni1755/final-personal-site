#!/usr/bin/env node
// Generates supabase/functions/_shared/content.ts from the real site source.
// Prose is extracted from the page components' JSX via the TypeScript AST, so
// every string in the corpus is text that actually renders on the site. Nothing
// is authored here. Run: node supabase/functions/_shared/build-content.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// ── literal evaluator: only plain JSON-able literals, never identifiers ──
function literal(node) {
  // `as const`, `satisfies T` and parentheses wrap the literal we want.
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ||
         ts.isParenthesizedExpression(node))) node = node.expression;
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) {
    const out = [];
    for (const el of node.elements) {
      const v = literal(el);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    // Lenient: keep the literal properties, drop the rest (render fns, styles).
    // Objects like BUCKET_META mix prose with arrow functions.
    const out = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined;
      const v = literal(p.initializer);
      if (key === undefined || v === undefined || PRESENTATION.has(key)) continue;
      if (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(|[\d.]+(px|rem|em|%)?)$/i.test(v)) continue;
      out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}
// keys that only ever carry styling/layout, never prose
const PRESENTATION = new Set(['color', 'bg', 'background', 'backgroundColor', 'border',
  'borderColor', 'style', 'className', 'icon', 'poster', 'variant', 'prefix', 'colors',
  'width', 'height', 'size', 'gap', 'padding', 'margin', 'fontSize', 'lineHeight']);

// ── markdown shaping per JSX tag ──
const tagName = (n) => {
  const e = n.tagName ?? n.openingElement?.tagName;
  const t = e ? e.getText() : '';
  return t.includes('.') ? t.slice(t.lastIndexOf('.') + 1) : t;
};
const HEADING = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ',
  SectionTitle: '## ', SectionTag: '### ' };
const WRAP = { strong: '**', Strong: '**', b: '**', em: '*', Em: '*', i: '*',
  code: '`', Code: '`' };
const BLOCK = new Set(['p', 'P', 'Lead', 'div', 'section', 'article', 'header', 'footer',
  'ul', 'ol', 'blockquote', 'Callout', 'figcaption', 'td', 'tr', 'table']);
const CODEBLOCK = new Set(['pre', 'MathBlock', 'CodeBlock']);
// purely decorative / non-prose subtrees
const SKIP = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'defs', 'style',
  'script', 'input', 'textarea', 'select', 'canvas', 'polygon', 'polyline', 'ellipse',
  'linearGradient', 'stop', 'clipPath', 'mask', 'filter', 'text', 'tspan']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  bull: '\u2022', middot: '\u00b7', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', times: '\u00d7',
  rarr: '\u2192', larr: '\u2190', deg: '\u00b0', copy: '\u00a9', trade: '\u2122' };
const decodeEntities = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) =>
    code[0] === '#'
      ? String.fromCodePoint(parseInt(code[1] === 'x' || code[1] === 'X' ? code.slice(2) : code.slice(1),
          code[1] === 'x' || code[1] === 'X' ? 16 : 10))
      : (ENTITIES[code.toLowerCase()] ?? m));

function renderData(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => renderData(v, depth)).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => {
        if (v && typeof v === 'object') {
          const inner = renderData(v, depth + 1);
          return inner ? `${pad}- ${k}:\n${inner}` : '';
        }
        return `${pad}- ${k}: ${v}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return `${pad}- ${value}`;
}

function defaultExportName(src) {
  for (const st of src.statements) {
    if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) return st.expression.text;
  }
  return undefined;
}

const LOCALS = new Map();
function extractPage(relPath, inlines = {}) {
  const src = ts.createSourceFile(relPath, read(relPath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const locals = new Map();
  const inlined = new Set();
  const out = [];
  const push = (s) => { if (s) out.push(s); };

  // collect every `const X = <json literal>` anywhere in the file
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const v = literal(n.initializer);
      if (v !== undefined) locals.set(n.name.text, v);
    }
    ts.forEachChild(n, collect);
  };
  collect(src);
  LOCALS.set(relPath, locals);

  // transient UI states ("Could not load…", spinners) are not site content
  const TRANSIENT = /\b(error|loading|isLoading|pending|notFound)\b/i;

  const walk = (node) => {
    if (ts.isIfStatement(node) && TRANSIENT.test(node.expression.getText())) {
      if (node.elseStatement) walk(node.elseStatement);
      return;
    }
    if (ts.isJsxText(node)) {
      const t = decodeEntities(node.text).replace(/[^\S\n]+/g, ' ');
      if (t.trim()) push(t);
      return;
    }
    if (ts.isJsxExpression(node)) {
      const e = node.expression;
      if (!e) return;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { push(e.text); return; }
      // A bare {IDENT} that resolves to a string constant is text the page
      // renders — dropping it silently loses facts like a User-Agent string.
      if (ts.isIdentifier(e)) {
        const v = locals.get(e.text);
        if (typeof v === 'string' || typeof v === 'number') push(String(v));
        return;
      }
      // {items.map(...)}, {Object.entries(items).map(...)}, {[{...}].map(...)}
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) &&
          e.expression.name.text === 'map') {
        const subjectNode = e.expression.expression;
        if (ts.isArrayLiteralExpression(subjectNode)) {
          const v = literal(subjectNode);
          if (v !== undefined) { push('\n' + renderData(v) + '\n'); return; }
        }
        const m = subjectNode.getText().match(/^(?:Object\.(?:entries|keys|values)\()?([A-Za-z_$][\w$]*)/);
        if (m && locals.has(m[1])) { push('\n' + renderData(locals.get(m[1])) + '\n'); return; }
      }
      // conditional JSX: descend so both branches' literal prose is captured,
      // minus the error/loading branch
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          && TRANSIENT.test(e.left.getText())) return;
      if (ts.isConditionalExpression(e) && TRANSIENT.test(e.condition.getText())) {
        walk(e.whenFalse);
        return;
      }
      ts.forEachChild(e, walk);
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = tagName(node);
      if (SKIP.has(tag)) return;
      // Splice a child component's prose in where the page actually renders it,
      // so it lands under the heading it belongs to rather than at the end.
      if (inlines[tag] && !inlined.has(tag)) {
        inlined.add(tag);
        push('\n\n' + inlines[tag] + '\n\n');
        return;
      }
      if (ts.isJsxSelfClosingElement(node)) { if (tag === 'br') push('\n'); return; }
      if (CODEBLOCK.has(tag)) {
        const inner = [];
        const save = out.length;
        node.children.forEach(walk);
        inner.push(...out.splice(save));
        const code = inner.join('').trim();
        if (code) push('\n```\n' + code + '\n```\n');
        return;
      }
      if (HEADING[tag]) {
        const save = out.length;
        node.children.forEach(walk);
        const inner = out.splice(save).join('').replace(/\s+/g, ' ').trim();
        if (inner) push(`\n\n${HEADING[tag]}${inner}\n\n`);
        return;
      }
      if (WRAP[tag]) {
        const save = out.length;
        node.children.forEach(walk);
        const inner = out.splice(save).join('').trim();
        if (inner) push(`${WRAP[tag]}${inner}${WRAP[tag]}`);
        return;
      }
      if (tag === 'li') { push('\n- '); node.children.forEach(walk); return; }
      if (BLOCK.has(tag)) { push('\n\n'); node.children.forEach(walk); push('\n\n'); return; }
      node.children.forEach(walk);
      return;
    }
    ts.forEachChild(node, walk);
  };
  // The page's own component carries the article; helper components defined
  // above it (diagrams, callouts) render inside it, so lead with the article.
  const main = src.statements.find((st) =>
    ts.isVariableStatement(st) &&
    st.declarationList.declarations.some((d) =>
      ts.isIdentifier(d.name) && d.name.text === defaultExportName(src)));
  if (main) walk(main);
  for (const st of src.statements) if (st !== main) walk(st);

  return out.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^- *\n+/gm, '- ')
    .replace(/^(- )[\u2022\u00b7]\s*/gm, '$1') // the marker already is the bullet
    .replace(/^- *$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── the route table. D4: /spearfishing/voice-agent is excluded (mock fallback). ──
const SITE = 'https://nikhilkulkarni1755.com';
const PAGES = [
  { id: 'home', route: '/', title: 'Nikhil Kulkarni — AI Engineer', kind: 'page',
    file: 'src/pages/Home.tsx',
    records: ['src/data/projects.json', 'src/data/contributions.json', 'src/data/blogs.json'] },
  { id: 'about', route: '/about', title: 'About Nikhil Kulkarni', kind: 'page',
    file: 'src/pages/About.tsx' },
  { id: 'projects', route: '/projects', title: 'Projects', kind: 'page',
    file: 'src/pages/Projects.tsx', records: ['src/data/projects.json'] },
  { id: 'blog', route: '/blog', title: 'Blog', kind: 'page', file: 'src/pages/Blog.tsx',
    records: ['src/data/blogs.json'] },
  { id: 'apps', route: '/apps', title: 'Apps', kind: 'page', file: 'src/pages/Apps.tsx',
    records: ['src/data/apps.json'] },
  { id: 'privacy-policy', route: '/privacy-policy', title: 'Privacy Policy', kind: 'page',
    file: 'src/pages/Privacy.tsx' },
  // Public crawler disclosure for InterestingFindsBot. Fully static — no
  // Supabase, no state gate, so no liveContent caveat applies.
  { id: 'bot', route: '/bot', title: 'Interesting Finds Bot — crawler disclosure',
    kind: 'page', file: 'src/pages/Bot.tsx' },
  // The page's chrome and its four verification criteria are static and real.
  // The finds themselves come from the `finds_published` table at page load,
  // so they are not extractable here — and the build cannot know what the table
  // holds. useFinds.ts is fail-closed (missing table, RLS error and genuinely
  // empty all resolve to an empty list, never stub rows), so this page gets the
  // same treatment as any other; D4's exclusion is still voice-agent alone.
  { id: 'interesting-finds', route: '/interesting-finds', kind: 'page',
    title: 'Interesting Finds', file: 'src/pages/InterestingFinds.tsx',
    also: ['src/components/finds/CriteriaLegend.tsx'],
    liveContent:
      'The list of finds on this page is read live from Supabase when the page loads, so it ' +
      'is not part of this corpus and its length is unknown here — this is not a statement ' +
      'that the list is empty. Fetch https://nikhilkulkarni1755.com/interesting-finds to see ' +
      'the current entries.' },
  { id: 'spearfishing-fireworks-ai', route: '/spearfishing/fireworks-ai', kind: 'page',
    title: 'Fireworks AI — disaggregated vs colocated inference', file: 'src/pages/FireworksAI.tsx',
    also: ['src/components/fireworks/Writeup.tsx', 'src/components/fireworks/LiveRunPanel.tsx'] },
  { id: 'take-homes-weave', route: '/take-homes/weave', kind: 'page',
    title: 'Weave take-home — ranking engineers from repo activity', file: 'src/pages/WeaveTakeHome.tsx' },
];
const POSTS = [
  { slug: 'matmul-to-ai', file: 'src/pages/MatmulTutorial.tsx' },
  { slug: 'linkedin-agent', file: 'src/pages/LinkedinAgentPost.tsx' },
  { slug: 'docker-secrets-injection', file: 'src/pages/DockerSecretsPost.tsx' },
];

const blogs = json('src/data/blogs.json');
const documents = [];

for (const p of PAGES) {
  // Listing pages are thin shells that render imported JSON; splice the real
  // records in so the document carries the content the page actually shows.
  const records = (p.records ?? [])
    .map((f) => renderData(json(f).map(({ content: _c, ...r }) => r)))
    .join('\n\n');
  const inlines = Object.fromEntries((p.also ?? []).map((f) =>
    [f.slice(f.lastIndexOf('/') + 1).replace(/\.tsx$/, ''), extractPage(f)]));
  let prose = extractPage(p.file, inlines);
  // Anything the page never renders directly is appended rather than dropped.
  for (const [tag, text] of Object.entries(inlines)) {
    if (!prose.includes(text)) prose += '\n\n' + text;
  }
  documents.push({
    id: p.id, route: p.route, url: SITE + p.route, title: p.title, kind: p.kind,
    tags: [], date: null, text: (prose + (records ? '\n\n' + records : '')).trim(),
    // Declares what this document provably does NOT cover, so a reader never
    // mistakes "not in the corpus" for "does not exist".
    ...(p.liveContent ? { liveContent: p.liveContent } : {}),
  });
}
for (const p of POSTS) {
  const meta = blogs.find((b) => b.slug === p.slug);
  if (!meta) throw new Error(`no blogs.json entry for ${p.slug}`);
  documents.push({
    id: `blog-${p.slug}`, route: `/blog/${p.slug}`, url: `${SITE}/blog/${p.slug}`,
    title: meta.title, kind: 'post', tags: meta.tags, date: meta.publishDate,
    subtitle: meta.subtitle, readTimeMinutes: meta.readTime, text: extractPage(p.file),
  });
}

for (const d of documents) {
  if (d.text.length < 200) throw new Error(`${d.id}: extracted only ${d.text.length} chars`);
}

// Structured resume, assembled from About.tsx's own declarations plus the
// Education block of its rendered prose. No values are authored here.
const aboutLocals = LOCALS.get('src/pages/About.tsx');
const aboutText = documents.find((d) => d.id === 'about').text;
const section = (heading) => {
  const start = aboutText.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`About.tsx has no "${heading}" section`);
  const rest = aboutText.slice(start + heading.length + 3);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
};
for (const k of ['experiences', 'skills', 'certifications']) {
  if (!aboutLocals.has(k)) throw new Error(`About.tsx no longer declares ${k}`);
}
const resume = {
  experience: aboutLocals.get('experiences'),
  education: section('Education'),
  skills: aboutLocals.get('skills'),
  certifications: aboutLocals.get('certifications'),
  source: `${SITE}/about`,
};

const content = {
  generatedAt: new Date().toISOString().slice(0, 10),
  site: SITE,
  owner: {
    name: 'Nikhil Kulkarni',
    headline: 'AI Engineer building reproducible, scalable AI systems',
    site: SITE,
    links: json('src/data/social.json'),
  },
  resume,
  documents,
  projects: json('src/data/projects.json'),
  contributions: json('src/data/contributions.json'),
  apps: json('src/data/apps.json'),
  posts: blogs.map(({ content: _drop, ...rest }) => ({
    ...rest, route: `/blog/${rest.slug}`, url: `${SITE}/blog/${rest.slug}`,
  })),
};

writeFileSync(
  join(ROOT, 'supabase/functions/_shared/content.ts'),
  `// GENERATED by supabase/functions/_shared/build-content.mjs — do not edit by hand.\n` +
  `// Every string below is extracted from the site's own source. Re-run the generator\n` +
  `// after changing src/pages/* or src/data/*.\n` +
  `export const content = ${JSON.stringify(content, null, 2)} as const;\n` +
  `export type Document = (typeof content.documents)[number];\n`
);

console.log(`wrote content.ts — ${documents.length} documents, ` +
  `${documents.reduce((n, d) => n + d.text.length, 0)} chars of prose, ` +
  `${content.projects.length} projects, ${content.contributions.length} contributions`);
for (const d of documents) console.log(`  ${d.route.padEnd(32)} ${String(d.text.length).padStart(6)} chars`);
