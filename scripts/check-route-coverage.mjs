#!/usr/bin/env node
// Drift check for src/data/routeMeta.ts's route coverage.
//
// routeMeta.ts is a hand-maintained mirror of the <Route path="..."> entries
// in src/App.tsx (the client-side router's own source of truth) — the same
// class of drift risk W5's functions/_lib/check-routes.mjs already caught
// once for the middleware allowlist, and W1's prerender-verify caught again
// for the markdown-mirror contract. Two routes (/interesting-finds, /bot)
// have appeared in App.tsx unannounced to this lane within a single working
// session; this exists so a third one can't land in routeMeta silently.
//
// App.tsx is read as TEXT, never imported: it's a React tree with
// browser-only code (framer-motion viewport hooks, etc.) that must not
// execute in a Node build script. routeMeta.ts, by contrast, is safe to
// import directly — it's pure data (the same way scripts/prerender.mjs
// already loads it) — so this diffs the real Object.keys(routeMeta), not a
// second regex pass that could itself drift from what routeMeta.ts exports.
//
// Run by hand (or wire into CI) whenever a route is added or removed:
//   node scripts/check-route-coverage.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const appTsxPath = join(root, 'src/App.tsx');
const routeMetaPath = join(root, 'src/data/routeMeta.ts');

const appTsx = readFileSync(appTsxPath, 'utf8');

// Every <Route path="..."> in App.tsx, regardless of which <Routes> block
// (the top-level one or the /take-homes/* early-return one) it's in — a
// plain text scan doesn't need to understand that branch to find them all.
const appRoutes = new Set(
  [...appTsx.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
);

// Exclusions from routeMeta.ts coverage — each justified individually, not a
// bare list, so nobody has to go find the decision record to see why a route
// that's in App.tsx is correctly absent from routeMeta.
const EXCLUDED_ROUTES = new Map([
  [
    '/blog/:slug',
    "a dynamic React Router pattern, not a concrete route. Its three real " +
      'destinations (/blog/matmul-to-ai, /blog/linkedin-agent, ' +
      '/blog/docker-secrets-injection) are each ALSO their own literal ' +
      '<Route path="..."> in App.tsx, listed above this catch-all with higher ' +
      'specificity, so React Router never actually dispatches a known slug to ' +
      'it (R2 A5) — those three already have their own routeMeta entries, ' +
      'checked like any other route. Only the bare ":slug" pattern itself is ' +
      'excluded here.',
  ],
  [
    '/spearfishing/voice-agent',
    'excluded from routeMeta (and therefore from crawlable metadata, the ' +
      'sitemap, and any markdown mirror) per coordinator decision D4: it ' +
      'renders Supabase-backed content with a hardcoded MOCK_DRUGS fallback ' +
      'when the table is empty, and this site ships no stub data as fact.',
  ],
]);

const expectedRoutes = new Set([...appRoutes].filter((p) => !EXCLUDED_ROUTES.has(p)));

let routeMeta;
try {
  const mod = await import(pathToFileURL(routeMetaPath).href);
  routeMeta = mod.routeMeta ?? mod.default;
} catch (err) {
  const isStrippingError = err instanceof SyntaxError || /strip|type/i.test(String(err?.message));
  console.error(`Could not import src/data/routeMeta.ts: ${err.message}`);
  if (isStrippingError) {
    console.error(
      'This usually means Node cannot strip routeMeta.ts\'s TypeScript syntax — ' +
        'requires Node >= 22.18.0 (pinned in .node-version; see AGENTS.md).',
    );
  }
  process.exit(1);
}
if (!routeMeta || typeof routeMeta !== 'object') {
  console.error('src/data/routeMeta.ts did not export a `routeMeta` (or default) object.');
  process.exit(1);
}
const actualRoutes = new Set(Object.keys(routeMeta));

const missing = [...expectedRoutes].filter((p) => !actualRoutes.has(p));
const stale = [...actualRoutes].filter((p) => !expectedRoutes.has(p));
if (missing.length || stale.length) {
  if (missing.length) {
    console.error('Routes in src/App.tsx missing from src/data/routeMeta.ts:');
    for (const p of missing) console.error(`  ${p}`);
  }
  if (stale.length) {
    console.error('Entries in src/data/routeMeta.ts with no matching <Route> in src/App.tsx:');
    for (const p of stale) console.error(`  ${p}`);
  }
  process.exit(1);
}

console.log(
  `OK — ${actualRoutes.size} routeMeta entries match src/App.tsx exactly ` +
    `(${appRoutes.size} <Route> elements, ${EXCLUDED_ROUTES.size} justified exclusions).`,
);
