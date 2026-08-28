/**
 * Prerender pass: serve the built dist/, visit every route in a real browser,
 * and write the rendered HTML back to dist/<route>.html so a plain HTTP GET
 * (curl, an AI crawler, an agent) receives real content with no JS.
 *
 * Two things about the output shape are deliberate:
 *
 * <route>.html, not <route>/index.html. Cloudflare Pages answers a bare /about
 * with a 308 to /about/ when the file on disk is a directory index, so an agent
 * that does not follow redirects gets an empty body from a site whose whole
 * claim is that a plain fetch returns real content. Pages serves /about.html
 * for /about directly, with no redirect.
 *
 * A file for every real route, including the ones we do not snapshot. Anything
 * without a file falls through public/_redirects to /index.html — which since
 * this pass exists is the fully rendered homepage. /spearfishing/voice-agent was
 * being served the homepage's exact bytes, canonical included, telling an agent
 * it was looking at a page it was not. So the routes we deliberately leave
 * un-snapshotted get their own file holding the neutral SPA shell, with the
 * homepage's identity claims stripped out.
 *
 * Measured on `wrangler pages dev` before choosing that shape: pointing the
 * _redirects catch-all at the shell instead does not work. Pages special-cases a
 * `/index.html` 200 rewrite as an SPA fallback that yields to real assets, but a
 * rewrite to `/app-shell` beats every asset (all 11 routes served the 1.3KB
 * shell), and one to `/app-shell.html` gets clean-URL'd, 308ing every route to
 * /app-shell. public/_redirects is therefore left exactly as it was.
 *
 * The pristine shell is stashed under node_modules/.cache, not in dist/ — it is a
 * build intermediate, not a page. This pass restores index.html from it on a
 * re-run, which is what makes the build idempotent.
 *
 * Nothing is written to dist/ until the browser and server are both down. While
 * the server is up, dist/ holds exactly what vite build emitted, so every route
 * renders into the pristine shell. Writing snapshots as we went meant each route
 * after the first was served the *rendered homepage* as its shell by the SPA
 * fallback, inheriting the homepage's canonical, og:type and JSON-LD, and
 * accumulating another JSON-LD block on every rebuild.
 */
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ROUTE_META = join(ROOT, 'src/data/routeMeta.ts');
const INDEX = join(DIST, 'index.html');
/**
 * The pristine SPA shell, stashed OUTSIDE dist/ so it is never deployed: it is a
 * build intermediate, and as a file in dist/ it shipped to production as a stray
 * page that 308'd to /app-shell and then 404'd. node_modules/.cache is the usual
 * home for this and is already ignored by git.
 */
const SHELL_CACHE = join(ROOT, 'node_modules/.cache/prerender/app-shell.html');

/**
 * Real routes in src/App.tsx that we deliberately do not snapshot, and so must
 * write a neutral shell for. Only D4's /spearfishing/voice-agent today: it renders
 * a hardcoded MOCK_DRUGS fallback, and we ship no fabricated data as fact.
 */
export const UNRENDERED = ['/spearfishing/voice-agent'];

/**
 * `expect` is the app-ready signal: a snapshot is only written once every one of
 * these real content strings is in the DOM. It is an assertion, not a timing
 * guess — a page still showing a loading skeleton fails the build.
 * /spearfishing/voice-agent is deliberately absent (decision D4: its Supabase
 * fallback is fabricated data and must never be baked into a static file).
 */
export const ROUTES = [
  { path: '/', expect: ['Creator of Iridium', 'Contributor to vLLM and SGLang'] },
  { path: '/projects', expect: ['A collection of my recent work in AI/ML, cloud infrastructure, and full-stack development'] },
  { path: '/blog', expect: ['Thoughts on software engineering, AI/ML, and building products'] },
  { path: '/apps', expect: ['End to End system designed to help build sustainable habits'] },
  { path: '/about', expect: ['Computer Science B.S. from Rutgers University'] },
  { path: '/privacy-policy', expect: ['Device types - browser and operating system information'] },
  // Static chrome only. This page's list comes from Supabase at runtime and
  // useFinds is fail-closed — a missing table, an RLS error and a genuinely empty
  // table all render the same empty state — so anything drawn from the list itself
  // would be an expect string that can never be satisfied when there is nothing
  // published yet.
  // Fully static disclosure page — no runtime data of any kind.
  { path: '/bot', expect: ['Never logs in, signs up, checks out, or submits a form', 'At most 25 pages per site, at least 2 seconds apart'] },
  {
    path: '/interesting-finds',
    expect: ['How a find earns its spot', 'Launches I dug into and found genuinely worth your time'],
    // The finds list is read from Supabase on page load and changes independently of
    // deploys, so capturing it would freeze a point-in-time list and serve it as
    // current until the next build. Not fabricated, but stale-presented-as-current,
    // which an agent reads as fact just the same. Drop everything in the Finds
    // section except its heading and let the live page fill it in — the same choice
    // W2's mirror and W4's corpus made. The chrome above it is the durable part.
    removeBeforeCapture: ['section[aria-labelledby="finds-heading"] > :not(h2)'],
  },
  { path: '/blog/matmul-to-ai', expect: ['Every layer in every neural network is fundamentally doing this one thing'] },
  { path: '/blog/linkedin-agent', expect: ['Six-stage LLM pipeline produces a personalized connection note'] },
  { path: '/blog/docker-secrets-injection', expect: ['hardcoded VM IPs, internal URLs, API keys, and passwords'] },
  { path: '/take-homes/weave', expect: ['Engineers who own subsystems end-to-end with depth and continuity'] },
  // Both strings below come only from public/spearfishing/fireworks-ai/data/*.json,
  // so they cannot appear until the page's sequential fetches have all landed.
  { path: '/spearfishing/fireworks-ai', expect: ['Qwen3-Coder-30B-A3B-Instruct', '21,543-token'] },
];

/** Minimum characters of rendered text before a route counts as rendered at all. */
const MIN_TEXT = 400;

/**
 * Per-route <title>/description/JSON-LD, owned by src/data/routeMeta.ts.
 * Contract: a `routeMeta` (or default) export keyed by the route path, each entry
 * `{ title: string, description: string, jsonLd?: object | object[] }`.
 * The file is optional — until it exists every snapshot just keeps the site-wide
 * title and description already in index.html, and the build still passes.
 */
/**
 * Both prerender scripts import routeMeta.ts directly, which relies on Node's
 * native TypeScript type stripping — unflagged in Node 22.18.0. Cloudflare Pages'
 * v3 build image defaults to 22.16.0, BELOW that, so `.node-version` at the repo
 * root pins it: Pages reads .nvmrc / .node-version / NODE_VERSION, and explicitly
 * does NOT read package.json `engines` (which is there for npm's local warning).
 * Without a pin the production build dies here on a syntax error with nothing
 * naming the cause, so name it.
 */
const MIN_NODE = '22.18';
export function assertNodeSupportsTypeScript(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  const [wantMajor, wantMinor] = MIN_NODE.split('.').map(Number);
  if (major > wantMajor || (major === wantMajor && minor >= wantMinor)) return;
  throw new Error(
    `Node ${version} cannot import src/data/routeMeta.ts: stripping ` +
      `its types needs Node >= ${MIN_NODE}. Pin it with .node-version (Cloudflare ` +
      `Pages reads that file; it ignores package.json engines).`
  );
}

async function loadRouteMeta() {
  if (!existsSync(ROUTE_META)) {
    console.log('src/data/routeMeta.ts not present — snapshots keep the site-wide meta');
    return null;
  }
  assertNodeSupportsTypeScript();
  const mod = await import(pathToFileURL(ROUTE_META).href);
  return mod.routeMeta ?? mod.default ?? null;
}

const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Replace the first tag matching `pattern`; insert before </head> if the shell has none. */
function setTag(html, pattern, tag) {
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
}

const nameMeta = (name) => new RegExp(`<meta\\s+name="${name}"[^>]*>`);
const propMeta = (prop) => new RegExp(`<meta\\s+property="${prop}"[^>]*>`);

/**
 * Rewrite the head with this route's metadata.
 *
 * index.html carries one site-wide set of tags — title, description, canonical,
 * og:type, og:image, twitter:card — that are right for the homepage and wrong for
 * the other ten routes. Every field routeMeta provides therefore REPLACES its
 * static tag in place; appending would leave the homepage's canonical standing on
 * all eleven pages, telling crawlers to index one page out of the eleven this work
 * exists to expose. Fields with no static tag (og:title, og:url, twitter:title, …)
 * are inserted. og:site_name has no routeMeta field and is correct site-wide, so
 * it is left alone. Iterating the `og`/`twitter` objects rather than naming their
 * keys means a field W3 adds later flows through with no change here.
 */
function injectMeta(html, meta) {
  // Unconditional, and before the `meta` guard: any JSON-LD in a captured page is
  // either another route's (the accumulation bug) or one the app injected itself at
  // runtime. src/pages/InterestingFinds.tsx appends an ItemList to document.head in
  // a useEffect, and React runs that effect again in every real browser — so baking
  // its output into the static file would leave two scripts sharing one @id, and a
  // numberOfItems frozen at whatever the table held at build time. Strip it and let
  // the page re-add its own, live.
  let out = html.replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, '');
  if (!meta) return out;

  if (meta.title) {
    out = setTag(out, /<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.title)}</title>`);
  }
  if (meta.description) {
    out = setTag(out, nameMeta('description'), `<meta name="description" content="${escapeAttr(meta.description)}">`);
  }
  if (meta.canonical) {
    out = setTag(out, /<link\s+rel="canonical"[^>]*>/, `<link rel="canonical" href="${escapeAttr(meta.canonical)}">`);
  }
  // The markdown twin has to come through here for the same reason canonical does:
  // one static tag in index.html would survive into all 11 snapshots pointing at
  // /index.md, so every page would advertise the homepage's twin.
  if (meta.markdownAlternate) {
    out = setTag(
      out,
      /<link[^>]*rel="alternate"[^>]*type="text\/markdown"[^>]*>/,
      `<link rel="alternate" type="text/markdown" href="${escapeAttr(meta.markdownAlternate)}">`
    );
  }
  for (const [key, value] of Object.entries(meta.og ?? {})) {
    out = setTag(out, propMeta(`og:${key}`), `<meta property="og:${key}" content="${escapeAttr(value)}">`);
  }
  for (const [key, value] of Object.entries(meta.twitter ?? {})) {
    out = setTag(out, nameMeta(`twitter:${key}`), `<meta name="twitter:${key}" content="${escapeAttr(value)}">`);
  }
  if (meta.jsonLd) {
    // </script> inside a JSON string would close the tag early.
    const json = JSON.stringify(meta.jsonLd).replace(/<\//g, '<\\/');
    out = out.replace('</head>', `<script type="application/ld+json">${json}</script></head>`);
  }
  return out;
}

/**
 * The built SPA shell with the homepage's identity claims removed. Serving this
 * verbatim would repeat the defect in miniature: index.html carries
 * `<link rel="canonical" href="https://nikhilkulkarni1755.com/">`, which on any
 * other route points a crawler at the wrong page. A page that makes no claim is
 * correct here; inventing a canonical would be authoring metadata, which is W3's.
 * Any markdown alternate goes too — D4 leaves this route without a twin, and R1
 * found that advertising one that does not resolve is worse than advertising none.
 */
function neutralShell(html) {
  return html
    .replace(/\n?\s*<link rel="canonical"[^>]*>/, '')
    .replace(/\n?\s*<link[^>]*rel="alternate"[^>]*>/g, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
}

/**
 * Empty the regions a page populates from a live source before we capture it.
 *
 * Safe because src/main.tsx mounts with createRoot().render(), not hydrateRoot():
 * the client replaces #root wholesale, so nothing removed here can affect what a
 * human sees. A comment is left in place of the removed nodes — comments are not
 * text an extractor reads as content, so this documents the gap for anyone reading
 * the source without asserting anything to an agent.
 */
async function removeRuntimeRegions(page, selectors) {
  if (!selectors?.length) return;
  await page.evaluate((sels) => {
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        el.replaceWith(
          document.createComment(
            ' populated at runtime from a live source; deliberately not captured at ' +
              'build time, so this file never serves a stale copy '
          )
        );
      }
    }
  }, selectors);
}

async function waitForContent(page, expected) {
  await page.waitForFunction(
    ([expected, minText]) => {
      const root = document.getElementById('root');
      if (!root) return false;
      const text = root.innerText || '';
      if (text.trim().length < minText) return false;
      return expected.every((s) => text.includes(s));
    },
    [expected, MIN_TEXT],
    { timeout: 30000 }
  );
}

/**
 * Scroll the whole page so framer-motion `whileInView` sections play, then return
 * to the top.
 *
 * Sweeping once at 60ms a step was too fast: elements were left at `opacity: 0`
 * because the page grew as earlier sections revealed, so the later ones never
 * entered view. That also made the output depend on timing — /projects came out
 * 513 bytes different between sessions. Sweeping until the page stops growing
 * settles every section, which is both the correct final state and a stable one.
 */
async function revealAll(page) {
  await page.evaluate(async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    let previousHeight = -1;
    for (let sweep = 0; sweep < 5 && document.body.scrollHeight !== previousHeight; sweep++) {
      previousHeight = document.body.scrollHeight;
      for (let y = 0; y <= document.body.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y);
        await pause(120);
      }
    }
    // A uniform sweep still missed one section near the end of the longest page,
    // leaving it at opacity 0 and making that page differ between builds. Walk
    // whatever is still hidden into view directly; this converges on "nothing
    // hidden" instead of depending on where the sweep happened to stop.
    for (let pass = 0; pass < 6; pass++) {
      const hidden = document.querySelectorAll('[style*="opacity: 0"]');
      if (!hidden.length) break;
      for (const el of hidden) {
        el.scrollIntoView({ block: 'center' });
        await pause(120);
      }
    }
    window.scrollTo(0, 0);
    await pause(200);
  });
}

/**
 * Wait until the document stops changing at all, so we never capture a page that is
 * still populating or still animating.
 *
 * Comparing only the LENGTH of the HTML was not enough: a framer-motion whileInView
 * transition was caught mid-flight on /projects, so two builds of the same commit
 * emitted `opacity: 0; transform: translateY(7.82624px)` and `opacity: 1; transform:
 * none` for the same element. Requiring three byte-identical samples in a row means
 * the animations have actually settled.
 */
async function waitForStableDom(page) {
  let previous = null;
  let repeats = 0;
  for (let i = 0; i < 80; i++) {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    repeats = html === previous ? repeats + 1 : 0;
    if (repeats >= 2) return;
    previous = html;
    await page.waitForTimeout(150);
  }
}

async function main() {
  const routeMeta = await loadRouteMeta();

  // The un-rendered shell is the one file every route renders into, so the pass has
  // to start from it. An empty #root is what identifies it: vite build emits that,
  // and a previous pass replaces it with the rendered homepage. Pristine => stash a
  // copy for later. Already rendered => this is a bare `npm run prerender` re-run,
  // so restore from that stash and start from the same input the first run had.
  // The stash is only ever READ when index.html is mutated, and only ever WRITTEN
  // from a pristine one, so it cannot go stale against the current build.
  let shell = await readFile(INDEX, 'utf8');
  if (shell.includes('<div id="root"></div>')) {
    await mkdir(dirname(SHELL_CACHE), { recursive: true });
    await writeFile(SHELL_CACHE, shell, 'utf8');
  } else {
    shell = await readFile(SHELL_CACHE, 'utf8');
    await writeFile(INDEX, shell, 'utf8');
  }

  const server = await preview({
    root: ROOT,
    preview: { port: 4180, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');

  // --no-sandbox: CI build containers run as root, where Chromium's sandbox refuses to
  // start. The only page this browser ever opens is our own freshly built dist/.
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // A build is not a visitor. Without this, every prerender run inserts a page_view row
  // and an active_sessions heartbeat per route, so each deploy would fabricate traffic in
  // the analytics tables. The counters these calls feed are ephemeral chrome that the real
  // client refetches the moment it hydrates, so nothing readable is lost by cutting them.
  // Supabase-backed CONTENT is handled by not capturing it at all — see removeBeforeCapture
  // — rather than by reading it here and freezing it into a file.
  await context.route('**://*.supabase.co/**', (r) => r.abort());

  const failures = [];
  const captures = [];

  try {
    for (const route of ROUTES) {
      const page = await context.newPage();
      try {
        await page.goto(origin + route.path, { waitUntil: 'networkidle', timeout: 30000 });
        await waitForContent(page, route.expect);
        await revealAll(page);
        await waitForStableDom(page);
        await waitForContent(page, route.expect);

        await removeRuntimeRegions(page, route.removeBeforeCapture);

        const captured = await page.evaluate(
          () => '<!DOCTYPE html>\n' + document.documentElement.outerHTML
        );
        const meta = routeMeta?.[route.path];
        if (routeMeta && !meta) console.warn(`  no routeMeta entry for ${route.path}`);
        const html = injectMeta(captured, meta);

        // Buffered, not written: dist/ must keep serving the pristine shell to
        // every route still to come. See the note at the top of this file.
        captures.push({
          out: join(DIST, route.path === '/' ? 'index.html' : `${route.path}.html`),
          html,
        });
        console.log(
          `captured   ${route.path.padEnd(34)} ${html.length} bytes${meta ? ' +meta' : ''}`
        );
      } catch (err) {
        failures.push(`${route.path}: ${err.message.split('\n')[0]}`);
        console.error(`FAILED     ${route.path} — ${err.message.split('\n')[0]}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  // Nothing is written on failure: a half-updated dist/ is worse than a stale one.
  if (failures.length) {
    console.error(`\nprerender failed for ${failures.length} route(s):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }

  for (const { out, html } of captures) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html, 'utf8');
  }

  const neutral = neutralShell(shell);
  for (const path of UNRENDERED) {
    const out = join(DIST, `${path}.html`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, neutral, 'utf8');
    console.log(`neutral shell ${path.padEnd(31)} ${neutral.length} bytes (not snapshotted, D4)`);
  }
  console.log(`\nprerendered ${ROUTES.length} routes into dist/`);
}

// Guarded so scripts/prerender-verify.mjs can import ROUTES without running the pass.
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
