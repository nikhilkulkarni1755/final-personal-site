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
// An empty heading — a section title with no resolvable content under it —
// reads as "this section exists and is empty" to an agent, which is worse
// than the section not being there at all: it implies an absence of work
// rather than an absence of extraction (this is exactly what happened to
// Contributions/Certifications before the cross-file render-prop fix, and
// it's worth keeping as a permanent safety net for any future gap of the
// same shape). A heading counts as empty when the very next block is
// itself a heading, or there is no next block at all. Runs to a fixed
// point since dropping one heading can make its predecessor's "next
// block" another heading.
function dropEmptyHeadings(markdown) {
  let blocks = markdown.split(/\n{2,}/);
  const headingLevel = (b) => {
    const m = /^(#{1,6})\s/.exec(b);
    return m ? m[1].length : null;
  };
  let changed = true;
  while (changed) {
    changed = false;
    const drop = new Set();
    for (let i = 0; i < blocks.length; i++) {
      const level = headingLevel(blocks[i]);
      if (level === null) continue;
      // A deeper heading right after (## then ### then real bullets) is
      // legitimate nesting, not emptiness — keep scanning past it. Only a
      // sibling/ancestor heading (level <= this one) with nothing but
      // headings in between means there was really nothing under this one.
      let hasContent = false;
      for (let j = i + 1; j < blocks.length; j++) {
        const jLevel = headingLevel(blocks[j]);
        if (jLevel !== null && jLevel <= level) break;
        if (jLevel === null) { hasContent = true; break; }
      }
      if (!hasContent) drop.add(i);
    }
    if (drop.size) {
      changed = true;
      blocks = blocks.filter((_, i) => !drop.has(i));
    }
  }
  return blocks.join('\n\n');
}

// that's a rendering trick, not distinct content, and would double every
// project/post/app in the mirror if left alone.
function dedupeSections(markdown) {
  // Home.tsx's carousels render `[...items, ...items]` — the WHOLE item
  // array duplicated once (A,B,C,A,B,C), not each item repeated in place.
  // Within each "## ..." section, greedily find the largest adjacent run
  // of blocks that exactly repeats immediately after itself and collapse
  // it to one copy, then keep scanning — rather than requiring the WHOLE
  // section body to be an exact half/half split, which breaks the moment
  // unrelated content (e.g. Home.tsx's un-headed "Featured Section" skill
  // cards, which sit right after the Apps carousel with no H2 of its own)
  // follows the duplicated run in the same section.
  const blocks = markdown.split(/\n{2,}/);
  const groups = [[]]; // groups[0] = everything before the first "## "
  for (const b of blocks) {
    if (/^##\s/.test(b)) groups.push([b]);
    else groups[groups.length - 1].push(b);
  }
  const out = [];
  for (const group of groups) {
    const heading = /^##\s/.test(group[0]) ? group[0] : null;
    const body = heading ? group.slice(1) : group;
    if (heading) out.push(heading);
    let i = 0;
    while (i < body.length) {
      let collapsed = false;
      const maxL = Math.floor((body.length - i) / 2);
      for (let L = maxL; L >= 1; L--) {
        let match = true;
        for (let k = 0; k < L; k++) {
          if (body[i + k] !== body[i + L + k]) { match = false; break; }
        }
        if (match) {
          out.push(...body.slice(i, i + L));
          i += 2 * L;
          collapsed = true;
          break;
        }
      }
      if (!collapsed) {
        out.push(body[i]);
        i += 1;
      }
    }
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
// FireworksAI.tsx destructures `active` (the currently-selected measurement
// run) from useFireworksCaptures(), a hook that fetches it at runtime from
// public/spearfishing/fireworks-ai/data/*.json — invisible to static
// extraction, which left several sentences with a value silently dropped
// out of them (e.g. "Reading a -token project"). The hook's own default
// selection (mode starts 'disaggregated'; a complete measured pair exists
// on the one real rig) is riga-disaggregated.json, so that's loaded here
// and threaded through as the real value — not a guess, the actual file
// the page would fetch on first load.
const fireworksDataDir = path.join(ROOT, 'public', 'spearfishing', 'fireworks-ai', 'data');
const activeRun = JSON.parse(fs.readFileSync(path.join(fireworksDataDir, 'riga-disaggregated.json'), 'utf8'));
// `activePair` gates the tail-latency section ("Where the split was
// supposed to pay") entirely — {activePair && <Section .../>} — and is
// the hook's own pairing of the one complete measured colocated/
// disaggregated pair on the same rig, loaded here the same way.
const colocatedRun = JSON.parse(fs.readFileSync(path.join(fireworksDataDir, 'riga-colocated.json'), 'utf8'));
const activePairData = { colocated: colocatedRun, disaggregated: activeRun };
const runBadgePath = path.join(ROOT, 'src', 'components', 'fireworks', 'RunBadge.tsx');
// RunBadge is "provenance for every number on the page" per its own doc
// comment (run id, model, dtype, interconnect, exact prefix token count +
// hash, cost, launch argv) — entirely gated on the same unresolvable
// `active`, so it was completely absent before. Its collapsed-state summary
// line is what names the actual model (Qwen3-Coder-30B-A3B-Instruct); the
// page never named it anywhere else, which is why grepping for the model
// name against the old mirror came back empty. open:true (the accordion's
// useState default is false) recovers the expanded detail too, the same
// targeted-state-override approach already used for WeaveTakeHome's
// EngineerCard(expanded: true).
const runProvenance = extractComponentMarkdown(runBadgePath, 'RunBadge', { run: activeRun }, { open: true });

let fireworksRaw = extractPageMarkdown(path.join(SRC, 'FireworksAI.tsx'), { active: activeRun, activePair: activePairData });
// One sentence is still unrecoverable without reimplementing phases.ts's
// timeline-duration math from scratch (a real risk of getting a number
// wrong rather than just missing one) — dropped rather than left broken,
// per "resolve it or drop the sentence."
const brokenSentence = 'This set finished in .';
if (!fireworksRaw.includes(brokenSentence)) {
  throw new Error(`Expected sentence "${brokenSentence}" not found in FireworksAI.tsx output — the source text this drop targets may have changed; update or remove this fix.`);
}
fireworksRaw = fireworksRaw.replace(brokenSentence, '').replace(/[ \t]+\n/g, '\n');
const fireworks = ensureH1First(
  [fireworksRaw, '## Measured run\n\n' + runProvenance].join('\n\n'),
  'A purpose-built disaggregated inference engine',
);

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
].map((p) => ({ ...p, md: dropEmptyHeadings(p.md) }));

for (const p of pages) {
  const abs = write(p.file, p.md);
  console.log(`wrote ${path.relative(ROOT, abs)}  (${wordCount(p.md)} words)`);
}

// ---------- llms.txt: curated index per llmstxt.org ----------
// Nikhil's own wording, verbatim — only proper-noun casing (Iridium,
// LinkedIn) and the space in "2 YOE" were normalized. Shared as one
// constant so llms.txt's blockquote and llms-full.txt's intro (which
// mirrors it) can never drift apart.
const BIO = 'Creator of Iridium — LinkedIn for AI Agents (iridiumhqmcp.com), merged PRs @ vLLM and SGLang, AWS DevOps Professional Certified, 2 YOE @ Google via Tata Consultancy Services.';

const llmsTxt = `# Nikhil Kulkarni

> ${BIO}

When to use this site: reach for it for concrete evidence of production
agent engineering — Iridium's MCP server design and tool ergonomics, agent
orchestration, merged contributions to vLLM and SGLang's inference
internals, and the cloud infrastructure (AWS, Kubernetes, EKS) underneath.
Every project and post below states what was built and, where measured,
what the result was. For background and contact, read /about.md. For the
full text of every page in one request, fetch /llms-full.txt.

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
  `# Nikhil Kulkarni — full site text\n\n> ${BIO}\n\nEvery page on ${SITE} that isn't excluded (see /spearfishing/voice-agent's exclusion note below), concatenated as plain markdown for a single-round-trip fetch. Generated from the real page source, not hand-copied — see /llms.txt for a shorter index with descriptions.`,
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
