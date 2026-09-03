// Independent safety net, run after scripts/gen-llms.mjs: parses each source
// page fresh (not through the interpretation engine at all) and checks that
// every literal string in it — wherever it appears syntactically — is
// present in that page's generated markdown.
//
// This has already been wrong twice in a way worth being explicit about:
// v1 only visited JsxText and string-literal JSX *children*, which missed
// content passed as a JSX *attribute* — `<Section title="..." blurb="...">`
// — entirely, and reported 100% coverage on a page missing a whole
// paragraph. The fix both times was tempting to make by adding one more
// node kind to a hand-maintained allow-list, which just moves the blind
// spot to whatever kind gets used next (props today, a computed key or a
// satisfies-typed literal tomorrow). So this version does not enumerate
// *where* text is allowed to appear; it visits every
// StringLiteral/NoSubstitutionTemplateLiteral node in the file, with no
// exception for its syntactic position, and treats each one as real content
// that must appear in the output UNLESS it matches one of a short, explicit,
// commented exclusion list below. Anything not on that list defaults to
// "must be checked" — so a new category of non-content string (or a real
// content drop) shows up as a loud reported failure, never a silent pass.
//
// It intentionally does not walk data pulled from arrays/JSON/hooks (that's
// Part 2, further down) or interactive-diagram state the generator is
// honestly allowed to drop when unresolvable (documented per-page in
// ALLOWED_MISSING) — a literal string constant in the source is never
// either of those.
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

// SVG is the one place a whole family of elements is legitimately
// text-free by construction — the rendering engine itself drops <svg>/
// <path> wholesale (see tsx-extract.mjs) because their attributes are
// graphics coordinates, not content. Matching that here (rather than
// letting every d=/viewBox=/points=/transform= value get flagged as
// "missing") means this list only needs to name element *kinds*, not
// individual attributes — new SVG attributes never need a new entry.
const SVG_ELEMENTS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask',
  'marker', 'ellipse', 'use', 'symbol',
]);

function jsxAttrName(node) {
  return ts.isJsxAttribute(node) ? node.name.getText() : null;
}

// Walks up from a string-literal node and answers: is this a case where we
// already know, structurally and unambiguously, that the string can never
// be rendered as visible page content? Each branch is a specific, narrow,
// commented reason — not a broad "attributes don't count" rule, because
// this codebase routes real content through attributes/props constantly
// (title=, blurb=, label=, description=, headers=, rows= are all genuine
// content on custom components, which is exactly what v1 missed).
// Tailwind/CSS utility-class strings, wherever they're assigned — most
// often *not* directly inside a `className=` attribute but in a local
// lookup object (`const borderColors = { purple: 'border-l-[#7c6aff]',
// ... }`) indexed at render time, which structural JsxAttribute-ancestor
// walking can't see without full data-flow analysis. Real prose in this
// codebase never contains a `[...]` arbitrary-value token or a `dark:`/
// `hover:`/`focus:` variant prefix, so requiring that signal (rather than
// just "hyphenated words," which prose also has) keeps this from ever
// matching actual sentences.
function looksLikeCssUtilityClasses(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const classTokenRe = /^[\w.#%(),/:_'"\[\]-]+$/;
  // Real prose can pass this per-token character check too (parens and
  // commas are legitimate punctuation, and a token like "GPT-4o" inside an
  // otherwise-ordinary sentence matches a bare `-\d` test) — caught this
  // for real reviewing the diff: "Anthropic Claude Sonnet (primary),
  // OpenAI GPT-4o (fallback)" would false-positive-exclude on a single
  // matching token. So the signal has to be DENSE, not just present: at
  // least half the tokens must look like a utility-class fragment
  // (bracketed arbitrary value, dark:/hover:/focus:/group- variant, or a
  // word-number pair like px-3/duration-300), which is true of an actual
  // class list ("rounded-lg border px-3 py-3 transition-all duration-300"
  // is 3/6) and essentially never true of a sentence with one incidental
  // hyphenated token among several real words.
  if (!tokens.every((t) => classTokenRe.test(t))) return false;
  const signalRe = /\[|dark:|hover:|focus:|group-|-\d/;
  const signalCount = tokens.filter((t) => signalRe.test(t)).length;
  // A single-token string (one whole class value like
  // "border-l-[#7c6aff]") just needs the one signal; multi-token strings
  // need real density (>=2 tokens AND >=30%) so an isolated "GPT-4o" or
  // "top-5" inside a normal sentence can't tip a whole paragraph into
  // being excluded.
  const required = tokens.length === 1 ? 1 : Math.max(2, Math.ceil(tokens.length * 0.3));
  return signalCount >= required;
}

// Native HTML attributes with well-established, universal, non-content
// semantics (tooltip text, accessibility/technical metadata) — but ONLY
// when the element is a real lowercase DOM tag. Deliberately never applied
// to a capitalized custom component: this codebase routes real content
// through component props constantly (Section's title=/blurb=, CompareTable's
// headers=/rows=), and a prop named "title" or "label" on a *custom*
// component has whatever meaning that component gives it, not HTML's.
const NATIVE_NONCONTENT_ATTRS = new Set([
  'title', 'rel', 'target', 'type', 'preload', 'loading', 'crossOrigin',
  'allow', 'role', 'method', 'encType', 'autoComplete', 'htmlFor', 'xmlns',
  'id', 'key', 'name',
]);

function isKnownNonContent(node) {
  // import/export module specifiers and dynamic import() calls: a file
  // path, never prose.
  const p = node.parent;
  if (p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return true;
  if (p && ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;

  // usePageAnalytics('some label') — a page-id string passed to this
  // codebase's own analytics hook, called consistently the same way on
  // every single page (verified: every call site in src/pages/*.tsx).
  // Often duplicates the page's real H1 (which is why this rule mattered
  // less before now — most such labels happened to already be checked via
  // the real heading), but not always: "Bot Disclosure" and "Fireworks AI
  // - Disaggregated Inference" are internal labels distinct from either
  // page's actual visible H1 text.
  if (p && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'usePageAnalytics' && p.arguments[0] === node) {
    return true;
  }

  // A string literal that lives inside a useEffect()/useLayoutEffect()
  // callback — e.g. InterestingFinds.tsx building and injecting a
  // <script type="application/ld+json"> tag via document.createElement in
  // an effect. This engine's renderer only ever interprets a component's
  // JSX *return value*; a useEffect body is imperative side-effect code
  // that runs after render and is never part of that return value, so
  // nothing in it — script ids, MIME types, JSON-LD payload strings
  // (including real prose duplicated into structured data for crawlers,
  // as here) — can appear in a static markdown mirror of the page. Scoped
  // narrowly to the effect *callback's own body*, not its dependency array,
  // by checking the string's nearest enclosing function is that exact
  // first-argument callback.
  let effectCur = node;
  while (effectCur) {
    if (ts.isArrowFunction(effectCur) || ts.isFunctionExpression(effectCur)) {
      const fp = effectCur.parent;
      if (
        fp && ts.isCallExpression(fp) && ts.isIdentifier(fp.expression) &&
        (fp.expression.text === 'useEffect' || fp.expression.text === 'useLayoutEffect') &&
        fp.arguments[0] === effectCur
      ) {
        return true;
      }
    }
    effectCur = effectCur.parent;
  }

  // TypeScript literal-type positions (`type Mode = 'colocated' |
  // 'disaggregated'`): compile-time type information, never a runtime
  // value, never rendered.
  if (p && ts.isLiteralTypeNode(p)) return true;

  // Walk up through parenthesized/property/array/object wrapper nodes to
  // find the nearest enclosing JsxAttribute and JsxElement, so `style={{
  // fontFamily: 'DM Mono, monospace' }}` and `<svg><path d="M0 0" /></svg>`
  // are recognized regardless of how deeply the literal is nested inside
  // the attribute's expression.
  let cur = node;
  let enclosingAttr = null;
  let enclosingTag = null;
  while (cur) {
    if (ts.isJsxAttribute(cur) && !enclosingAttr) enclosingAttr = cur;
    if ((ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) && !enclosingTag) {
      enclosingTag = (ts.isJsxSelfClosingElement(cur) ? cur.tagName : cur.openingElement.tagName).getText().toLowerCase();
    }
    if (enclosingAttr && enclosingTag) break;
    cur = cur.parent;
  }
  // A `style={{...}}` object's property values: CSS, not content.
  if (enclosingAttr && jsxAttrName(enclosingAttr) === 'style') return true;
  // A `className` value (plain string or template literal): Tailwind/CSS
  // tokens, not content.
  if (enclosingAttr && jsxAttrName(enclosingAttr) === 'className') return true;
  // Any attribute on an SVG graphics element (d=, viewBox=, fill=,
  // transform=, points=, ...): coordinates/styling, not content — matches
  // the renderer's own wholesale drop of these elements.
  if (enclosingAttr && enclosingTag && SVG_ELEMENTS.has(enclosingTag)) return true;
  // Text inside a <style>{`...`}</style> tag (Home.tsx's Credly-badge CSS
  // override): raw CSS rules, matches the renderer's own decision to drop
  // <style>/<script> tags entirely rather than emit stylesheet text as
  // page content.
  if (enclosingTag === 'style') return true;
  // title=/rel=/aria-*=/... on a real (lowercase) DOM element only.
  if (enclosingAttr && enclosingTag && /^[a-z]/.test(enclosingTag)) {
    const attrName = jsxAttrName(enclosingAttr);
    if (NATIVE_NONCONTENT_ATTRS.has(attrName) || attrName.startsWith('aria-') || attrName.startsWith('data-')) return true;
  }

  if (looksLikeCssUtilityClasses(node.text)) return true;

  // A literal passed straight to a React state setter (setCaption('...'),
  // setStatus('...'), setBtnText('...')) describes a FUTURE state — one
  // frame of a click-triggered animation — not literal JSX content. The
  // animation's actual default-rendered text is a separate literal, the
  // one passed to the matching useState(...) call, which this same walker
  // still visits and checks normally (not excluded by this rule, since
  // `useState` doesn't match `set[A-Z]`). Verified against every setX(...)
  // call site in the in-scope pages before adding this rule — all of them
  // are exactly this pattern (setCaption/setStatus/setExplain/setBtnText/
  // setPhase in SecretLeakAnimation, PipelineAnimation,
  // ReplyApprovalAnimation, and MatmulTutorial's three GPU-pipeline demos).
  if (p && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && /^set[A-Z]/.test(p.expression.text) && p.arguments[0] === node) {
    return true;
  }
  // The same animations also thread a per-step caption through a *data*
  // array (`PIPELINE_STAGES[i].caption`, `STEPS[i].caption`,
  // `DOT_PRODUCTS[i].expr`) rather than a literal argument, which the rule
  // above can't see without full data-flow tracing. Verified: every
  // `caption:`/`expr:` object-literal property in the in-scope pages is
  // exactly this same animation-step-text pattern (grepped and read each
  // one before adding this rule) — never a field name reused elsewhere for
  // default-rendered content.
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && (p.name.text === 'caption' || p.name.text === 'expr') && p.initializer === node) {
    return true;
  }

  return false;
}

function collectLiteralLeaves(absFile) {
  const text = fs.readFileSync(absFile, 'utf8');
  const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const leaves = [];
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) && !isKnownNonContent(node)) {
      const t = norm(node.text);
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
  ['InterestingFinds.tsx', 'interesting-finds.md'],
  ['Bot.tsx', 'bot.md'],
];

// Two exceptions, both judged and documented rather than silently allowed:
// the error-state heading only renders when the capture JSON fails to load
// (findReturnJsx picks the real content return, which is correct — the
// error text is not content); and the mode-toggle UI is gated on
// `canCompare`, derived from a runtime fetch() this static engine cannot
// see (the same documented limitation as the page's other runtime-fetched
// numbers). Neither is a fact about the project that an agent would miss.
const ALLOWED_MISSING = {
  // Live-engine-gated "Try it" panel: every one of these strings only
  // renders when a real GPU gateway/quota/engine state exists at runtime
  // (useFireworksLive/useFireworksQuota), which a static file can't know
  // any more than `activePair` could before it was resolved from real JSON
  // — the difference is these genuinely have no JSON file backing them
  // (they describe live infrastructure state, not a recorded measurement).
  // 'No runs found.' is a second-level fallback nested inside the
  // already-excluded "Could not load the capture data" error branch.
  // usePageAnalytics's argument is a hook call parameter (an internal
  // page-id string), never rendered as page text at all.
  'FireworksAI.tsx': [
    'Could not load the capture data',
    'serving mode:',
    'same rig, same model — only the split changes',
    'No runs found.',
    'Free-text editing needs a live engine. The example prompts above replay real recorded runs.',
    'Prompt quota is unavailable right now, so free text is closed.',
    'Waking a GPU — this takes a few minutes from cold.',
    'out_of_scope',
    'out of scope — this engine only edits the project above.',
    'Fireworks AI - Disaggregated Inference',
  ],
  // Home.tsx's certificationsData feeds only a Credly embed's data-*
  // attributes and a JSX-commented-out <h3> (see source) — genuinely never
  // rendered as visible text on the live page, consistent with the whole
  // Certifications section being correctly dropped as empty
  // (dropEmptyHeadings in gen-llms.mjs). The embed script URL and its
  // companion <style> block are DOM/CSS plumbing for that same widget.
  // The 4 Credly badge-id UUIDs feeding the same widget are separately
  // (and correctly) caught by looksLikeCssUtilityClasses's single-token
  // digit-hyphen check, so they don't need an explicit entry here.
  'Home.tsx': [
    'Developer Associate',
    'Cloud Practitioner',
    '//cdn.credly.com/assets/utilities/embed.js',
  ],
  // Two animations, same verified pattern as PIPELINE_STAGES/STEPS
  // elsewhere: 'unsafe-reveal' is a phase-identifier token (SecretLeakAnimation's
  // STEPS array + isAtLeast() membership checks), never displayed text —
  // the *displayed* caption for each phase is a separate `caption:` field,
  // already covered by the caption/expr exclusion rule. 'click to resume'
  // is the untaken branch of `running ? 'click to pause' : 'click to
  // resume'` — running defaults to true, so 'click to pause' (verified
  // present) is the real default-rendered text.
  'DockerSecretsPost.tsx': ['unsafe-reveal', 'click to resume'],
  // Same animation-ternary pattern: `phase === 'loading' ? '↓ reading
  // tiles' : phase === 'writeback' ? '↑ writing results' : '↕'` — phase
  // defaults to 'idle', so neither named branch is the default; '↕' is
  // (verified present). '(tile loaded)' is the untaken branch of a Set
  // membership check that starts empty — '(empty)' is the default
  // (verified present after adding new Set()/Array.from() support).
  'MatmulTutorial.tsx': ['↓ reading tiles', '↑ writing results', '(tile loaded)'],
  // WeaveTakeHome only expands the default bucket (feature_owner) — see
  // gen-llms.mjs's own documented scope decision — so BUCKET_META's
  // 'reviewer' and 'infra' bucket metric labels (keyMetrics/allMetrics)
  // are real but require clicking the bucket switcher, same as the
  // Thought-Process dropdown's per-doc descriptions (already extracted
  // directly for their *content*, just not this exact subtitle wording).
  // 'feature_owner' itself is the internal bucket *key* (useState default
  // + a lookup index), not display text — the human-readable label
  // "Feature Owner" is separately verified present. 'space-between' is a
  // CSS justify-content value returned by the `between()` style helper
  // function, structurally invisible to the style-attribute-ancestor
  // check because the object literal lives in a separate function
  // declaration, not lexically inside any JSX attribute.
  'WeaveTakeHome.tsx': [
    'feature_owner',
    'space-between',
    'The 7-category framework I designed',
    "What I'd build next",
    'Issues & decisions during collection',
    'Engineers who unblock the team and maintain code quality',
    'Engineers who enable the team through tooling, CI/CD, and platform work',
    'Reviews given', 'Changes requested', 'Unique authors', 'Total reviews given',
    'PRs reviewed', 'Changes req. ratio', 'Unique authors reviewed',
    'Comment substance ratio', 'Avg review speed', 'Reviewed PR merge rate',
    'Times requested', 'Subsystems touched', 'CI/CD file changes',
    'Total PRs authored', 'Infra PRs count', 'Infra PR ratio', 'Infra merge rate',
    'Infra subsystems', 'Dep. update PRs',
  ],
  // JSONLD_SCRIPT_ID is declared once at module scope and referenced only
  // by identifier from inside the useEffect (as the injected <script>'s
  // DOM id, and again in the cleanup's getElementById lookup) — the
  // useEffect-body exclusion above only sees literal string *nodes*
  // lexically inside the effect, not a same-value identifier declared
  // outside it. A DOM element id, never rendered page text either way.
  'InterestingFinds.tsx': ['interesting-finds-jsonld'],
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
