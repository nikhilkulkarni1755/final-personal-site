/**
 * Prerender pass: serve the built dist/, visit every route in a real browser,
 * and write the rendered HTML back to dist/<route>/index.html so a plain HTTP
 * GET (curl, an AI crawler, an agent) receives real content with no JS.
 *
 * Cloudflare Pages resolves static files before _redirects, so /about is served
 * from dist/about/index.html and the `/* /index.html 200` catch-all still covers
 * any path we did not snapshot.
 */
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/**
 * `expect` is the app-ready signal: a snapshot is only written once every one of
 * these real content strings is in the DOM. It is an assertion, not a timing
 * guess — a page still showing a loading skeleton fails the build.
 * /spearfishing/voice-agent is deliberately absent (decision D4: its Supabase
 * fallback is fabricated data and must never be baked into a static file).
 */
const ROUTES = [
  { path: '/', expect: ['Creator of Iridium', 'Contributor to vLLM and SGLang'] },
  { path: '/projects', expect: ['A collection of my recent work in AI/ML, cloud infrastructure, and full-stack development'] },
  { path: '/blog', expect: ['Thoughts on software engineering, AI/ML, and building products'] },
  { path: '/apps', expect: ['End to End system designed to help build sustainable habits'] },
  { path: '/about', expect: ['Computer Science B.S. from Rutgers University'] },
  { path: '/privacy-policy', expect: ['Device types - browser and operating system information'] },
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

/** Scroll the whole page so framer-motion `whileInView` sections reveal, then return to top. */
async function revealAll(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 120));
  });
}

/** Wait until the DOM stops changing size, so we never capture a half-populated page. */
async function waitForStableDom(page) {
  let previous = -1;
  for (let i = 0; i < 40; i++) {
    const size = await page.evaluate(() => document.documentElement.outerHTML.length);
    if (size === previous) return;
    previous = size;
    await page.waitForTimeout(150);
  }
}

async function main() {
  const server = await preview({
    root: ROOT,
    preview: { port: 4180, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // A build is not a visitor. Without this, every prerender run inserts a page_view row
  // and an active_sessions heartbeat per route, so each deploy would fabricate traffic in
  // the analytics tables. The counters these calls feed are ephemeral chrome that the real
  // client refetches the moment it hydrates, so nothing readable is lost by cutting them.
  await context.route('**://*.supabase.co/**', (r) => r.abort());

  const failures = [];

  try {
    for (const route of ROUTES) {
      const page = await context.newPage();
      try {
        await page.goto(origin + route.path, { waitUntil: 'networkidle', timeout: 30000 });
        await waitForContent(page, route.expect);
        await revealAll(page);
        await waitForStableDom(page);
        await waitForContent(page, route.expect);

        const html = await page.evaluate(
          () => '<!DOCTYPE html>\n' + document.documentElement.outerHTML
        );
        const out = join(DIST, route.path === '/' ? '' : route.path, 'index.html');
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, html, 'utf8');
        console.log(`prerendered ${route.path.padEnd(34)} ${html.length} bytes`);
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

  if (failures.length) {
    console.error(`\nprerender failed for ${failures.length} route(s):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`\nprerendered ${ROUTES.length} routes into dist/`);
}

await main();
