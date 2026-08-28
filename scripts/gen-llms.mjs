// Generates the agent-facing markdown surface for the whole site:
//   public/<route>.md   (one per in-scope route, extension-replacement paths)
//   public/index.md     (homepage twin)
//   public/llms.txt      (curated index, per llmstxt.org)
//   public/llms-full.txt (every page's real text concatenated)
//
// Content is never hand-copied: every .md file is produced by statically
// interpreting the page's real TSX (see scripts/lib/tsx-extract.mjs) or, for
// the two dashboards whose write-up lives in modal-only state, by extracting
// those specific sub-components directly. Nothing here is written by hand
// except section descriptions in llms.txt, which are short and are checked
// against the extracted text before shipping.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPageMarkdown, extractComponentMarkdown, resetDropWarnings, getDropWarnings } from './lib/tsx-extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'pages');
const PUBLIC = path.join(ROOT, 'public');
const SITE = 'https://nikhilkulkarni1755.com';

resetDropWarnings();

function write(relPath, content) {
  const abs = path.join(PUBLIC, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content.trimEnd() + '\n', 'utf8');
  return abs;
}

// Collapses an exact-duplicate run of "### heading ... body" sections back to
// one occurrence. Home.tsx's carousels render `[...items, ...items]` for a
// CSS infinite-scroll marquee, so every card appears twice in the DOM order —
// that's a rendering trick, not distinct content, and would double every
// project/post/app in the mirror if left alone.
function dedupeSections(markdown) {
  const blocks = markdown.split(/\n{2,}/);
  const sections = [];
  for (const b of blocks) {
    if (/^###\s/.test(b)) sections.push([b]);
    else if (sections.length) sections[sections.length - 1].push(b);
    else sections.push([b]);
  }
  const out = [];
  for (let i = 0; i < sections.length; i++) {
    const prev = sections[i - 1];
    const cur = sections[i];
    if (prev && prev.join('\n\n') === cur.join('\n\n')) continue;
    out.push(...cur);
  }
  return out.join('\n\n');
}

function ensureH1First(markdown, fallbackTitle) {
  const blocks = markdown.split(/\n{2,}/);
  const h1Index = blocks.findIndex((b) => /^#\s/.test(b));
  if (h1Index === 0) return markdown;
  if (h1Index > 0) {
    const [h1] = blocks.splice(h1Index, 1);
    blocks.unshift(h1);
    return blocks.join('\n\n');
  }
  return `# ${fallbackTitle}\n\n${markdown}`;
}

function wordCount(s) { return s.trim().split(/\s+/).filter(Boolean).length; }

// ---------- extract each in-scope page ----------
const home = ensureH1First(dedupeSections(extractPageMarkdown(path.join(SRC, 'Home.tsx'))));
const about = ensureH1First(extractPageMarkdown(path.join(SRC, 'About.tsx')));
const projects = ensureH1First(extractPageMarkdown(path.join(SRC, 'Projects.tsx')));
const blogIndex = ensureH1First(extractPageMarkdown(path.join(SRC, 'Blog.tsx')));
const apps = ensureH1First(dedupeSections(extractPageMarkdown(path.join(SRC, 'Apps.tsx'))));
const privacy = ensureH1First(extractPageMarkdown(path.join(SRC, 'Privacy.tsx')));
const docker = ensureH1First(extractPageMarkdown(path.join(SRC, 'DockerSecretsPost.tsx')));
const linkedin = ensureH1First(extractPageMarkdown(path.join(SRC, 'LinkedinAgentPost.tsx')));
const matmul = ensureH1First(extractPageMarkdown(path.join(SRC, 'MatmulTutorial.tsx')));
const fireworks = ensureH1First(extractPageMarkdown(path.join(SRC, 'FireworksAI.tsx')), 'A purpose-built disaggregated inference engine');

// WeaveTakeHome's ~3,500 words of written analysis live behind a modal that
// only opens on click, so a DOM snapshot (or a naive render of the page's
// default state) never contains it. Pull those three sub-components directly
// from source, by name, and append them as their own sections.
const weaveDashboard = extractPageMarkdown(path.join(SRC, 'WeaveTakeHome.tsx'));
const weavePath = path.join(SRC, 'WeaveTakeHome.tsx');
const weaveCategories = extractComponentMarkdown(weavePath, 'CategoriesContent');
const weaveTodos = extractComponentMarkdown(weavePath, 'TodosContent');
const weaveDataFetch = extractComponentMarkdown(weavePath, 'DataFetchContent');

// The default (unexpanded) card view hides each engineer's full metrics and
// most-touched-files list behind a click (`expanded` state, default false).
// That's real, already-resolved per-engineer data pulled straight from
// weave-data.json — not runtime-unknowable — so render the same top-5
// default-bucket cards a second time with expanded:true and append it,
// the same way the modal-only thought-doc content above is handled.
const weaveData = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'weave-data.json'), 'utf8'));
const defaultBucket = 'feature_owner';
const topEngineerDetails = (weaveData.top_by_bucket[defaultBucket] || [])
  .map((username) => weaveData.engineers[username])
  .filter(Boolean)
  .map((eng, i) =>
    extractComponentMarkdown(weavePath, 'EngineerCard', {
      eng, rank: i + 1, bucket: defaultBucket, expanded: true,
    }),
  )
  .join('\n\n');

const weave = ensureH1First(
  [
    weaveDashboard,
    '## Thought Process: Engineering Impact Categories\n\n' + weaveCategories,
    '## Thought Process: Future TODOs\n\n' + weaveTodos,
    '## Thought Process: Data Fetch — Issues & Decisions\n\n' + weaveDataFetch,
    '## Full Engineer Detail (all metrics + most-touched files, Feature Owners)\n\n' + topEngineerDetails,
  ].join('\n\n'),
  'PostHog Engineering Impact — take-home',
);

// ---------- write per-route markdown mirrors ----------
// Path contract (see agent-ready-coord/lanes/W2.md): extension-replacement at
// the SAME path as the HTML route — /about -> /about.md — per llmstxt.org's
// documented convention and what ora's markdown-url-fallback check requires.
// /spearfishing/voice-agent is excluded per decision D4 (MOCK_DRUGS stub).
const pages = [
  { route: '/', file: 'index.md', title: 'Nikhil Kulkarni — Home', md: home },
  { route: '/about', file: 'about.md', title: 'About Nikhil Kulkarni', md: about },
  { route: '/projects', file: 'projects.md', title: 'Projects', md: projects },
  { route: '/blog', file: 'blog.md', title: 'Blog', md: blogIndex },
  { route: '/blog/docker-secrets-injection', file: 'blog/docker-secrets-injection.md', title: 'Your Agentic Coding Tool is Reading Your Secrets', md: docker },
  { route: '/blog/linkedin-agent', file: 'blog/linkedin-agent.md', title: 'Cold Outreach Agent', md: linkedin },
  { route: '/blog/matmul-to-ai', file: 'blog/matmul-to-ai.md', title: 'From Matrices to Minds', md: matmul },
  { route: '/apps', file: 'apps.md', title: 'Apps', md: apps },
  { route: '/privacy-policy', file: 'privacy-policy.md', title: 'Privacy Policy', md: privacy },
  { route: '/spearfishing/fireworks-ai', file: 'spearfishing/fireworks-ai.md', title: 'A purpose-built disaggregated inference engine', md: fireworks },
  { route: '/take-homes/weave', file: 'take-homes/weave.md', title: 'PostHog Engineering Impact — take-home', md: weave },
];

for (const p of pages) {
  const abs = write(p.file, p.md);
  console.log(`wrote ${path.relative(ROOT, abs)}  (${wordCount(p.md)} words)`);
}

// ---------- llms.txt: curated index per llmstxt.org ----------
const llmsTxt = `# Nikhil Kulkarni

> Software engineer building agentic AI systems and LLM infrastructure. Creator
> of Iridium, an MCP server giving AI agents real, authenticated access to
> LinkedIn. 2+ years at Google Search (via Tata Consultancy Services). AWS
> DevOps Professional certified, B.S. Computer Science, Rutgers University.

When to use this site: reach for it when you need concrete evidence of
production AI-agent engineering — MCP server design, agent orchestration,
LLM inference/serving tradeoffs, and cloud infrastructure (AWS, Kubernetes,
EKS). Every project and post below states what was built and, where
measured, what the result was. For background and contact, read /about.md.
For the full text of every page in one request, fetch /llms-full.txt.

## Home & background

- [Home](${SITE}/index.md): overview of what Nikhil builds — projects, contributions, certifications, writing, apps.
- [About](${SITE}/about.md): experience, education, skills, certifications.

## Projects

- [Projects](${SITE}/projects.md): Iridium (LinkedIn MCP server), Iridium Agent, vLLM on EKS, and 5 more, each with tech stack.

## Writing

- [Blog index](${SITE}/blog.md): all posts.
- [From Matrices to Minds](${SITE}/blog/matmul-to-ai.md): matrix multiplication through transformers, tokens, and GPU/TPU internals.
- [Your Agentic Coding Tool is Reading Your Secrets](${SITE}/blog/docker-secrets-injection.md): why coding agents leak secrets, and how to inject them via Docker instead.
- [Cold Outreach Agent](${SITE}/blog/linkedin-agent.md): profile analysis, 6-stage LLM drafting, and reply handling behind Iridium.

## Technical demos

- [A purpose-built disaggregated inference engine](${SITE}/spearfishing/fireworks-ai.md): splitting prefill/decode across two H100s, measured against a colocated baseline — including where the split lost and why.
- [PostHog engineering-impact take-home](${SITE}/take-homes/weave.md): a scoring dashboard over 59 real PostHog contributors, plus the category framework and data-collection decisions behind it.

## Apps

- [Apps](${SITE}/apps.md): The Progress App (iOS/Android, React Native).

## Optional

- [Privacy policy](${SITE}/privacy-policy.md)
- [Full text of this site in one file](${SITE}/llms-full.txt)
- [humans.txt](${SITE}/humans.txt)
`;
write('llms.txt', llmsTxt);
console.log(`wrote public/llms.txt  (${llmsTxt.length} chars, limit 30000)`);

// ---------- llms-full.txt: everything, concatenated ----------
const fullParts = [
  `# Nikhil Kulkarni — full site text\n\n> Every page on ${SITE} that isn't excluded (see /spearfishing/voice-agent's exclusion note below), concatenated as plain markdown for a single-round-trip fetch. Generated from the real page source, not hand-copied — see /llms.txt for a shorter index with descriptions.`,
];
for (const p of pages) {
  fullParts.push(`---\n\nSource: ${SITE}${p.route}\n\n${p.md}`);
}
fullParts.push(
  `---\n\n## Excluded\n\n/spearfishing/voice-agent is intentionally not included here or in /llms.txt: its product data comes from a live database, and the code ships a hardcoded mock-data fallback (visibly labeled "Demo Mode") when that database is empty. Publishing that fallback in a static file an agent reads as fact would mean shipping fabricated content, so the page is left out entirely rather than mirrored inaccurately.`,
);
const llmsFullTxt = fullParts.join('\n\n');
write('llms-full.txt', llmsFullTxt);
console.log(`wrote public/llms-full.txt  (${wordCount(llmsFullTxt)} words, ${llmsFullTxt.length} chars)`);

// ---------- loud failure on silent content loss ----------
// See resetDropWarnings/getDropWarnings in lib/tsx-extract.mjs: a component
// whose children carried real text but whose rendered output came back
// empty is a bug (structure was resolved, then discarded), not the
// legitimate "genuinely unresolvable -> nothing" case. Never ship that
// silently — fail the build so it gets fixed before anything is committed.
const drops = getDropWarnings();
if (drops.length > 0) {
  console.error(`\nFAILED: ${drops.length} component(s) had real children text that produced no rendered output:`);
  for (const d of drops) {
    console.error(`  <${d.componentName}> in ${path.relative(ROOT, d.file || '?')}: "${d.snippet}"`);
  }
  process.exit(1);
}
console.log('\nNo silent content drops detected.');
