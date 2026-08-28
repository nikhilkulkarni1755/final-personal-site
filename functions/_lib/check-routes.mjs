#!/usr/bin/env node
// Drift check for functions/_middleware.js's route knowledge: STATIC_ROUTES
// (exact-match routes) and DYNAMIC_ROUTES (:param routes, each requiring an
// explicit decision about how it's handled — see the comment above
// DYNAMIC_ROUTES in _middleware.js).
//
// Both are hand-maintained mirrors of src/App.tsx (the client-side router's
// own source of truth). A route added there and not here silently 404s at
// the edge for humans and agents alike — that already happened twice
// (/interesting-finds, a STATIC_ROUTES miss; then /interesting-finds/:slug,
// a DYNAMIC_ROUTES miss, since a :param route is filtered out of the
// STATIC_ROUTES comparison entirely and was previously acknowledged nowhere).
// This can't be solved by importing App.tsx directly: it's a React tree,
// executing it here would run browser-only code outside a browser, and
// Cloudflare Pages Functions have no filesystem access at request time to
// re-check it live in production. So this is a text-based check instead,
// meant to be run by hand (or wired into CI) whenever a route is added:
//
//   node functions/_lib/check-routes.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appTsx = readFileSync(join(here, '../../src/App.tsx'), 'utf8');
const middleware = readFileSync(join(here, '../_middleware.js'), 'utf8');
const blogs = JSON.parse(readFileSync(join(here, '../../src/data/blogs.json'), 'utf8'));

const allAppRoutes = [...appTsx.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const appDynamicRoutes = new Set(allAppRoutes.filter((path) => path.includes(':')));

// Every <Route path="..."> in App.tsx, minus dynamic :param ones — those are
// checked separately below, not against STATIC_ROUTES — and minus each
// blog post's own literal <Route path="/blog/<slug>">, which /blog/:slug's
// DYNAMIC_ROUTES entry already covers via BLOG_SLUGS, not via STATIC_ROUTES.
const blogSlugRoutes = new Set(blogs.map((post) => `/blog/${post.slug}`));
const appStaticRoutes = new Set(
  allAppRoutes.filter((path) => !path.includes(':') && !blogSlugRoutes.has(path)),
);

// Both Map/array literals in _middleware.js, read the same way — as text,
// not executed — so this has no dependency on how that module loads.
const staticRoutesBlock = middleware.match(/const STATIC_ROUTES = new Map\(\[([\s\S]*?)\]\);/);
const dynamicRoutesBlock = middleware.match(/const DYNAMIC_ROUTES = \[([\s\S]*?)\];/);
if (!staticRoutesBlock || !dynamicRoutesBlock) {
  console.error('Could not find STATIC_ROUTES or DYNAMIC_ROUTES in functions/_middleware.js — check the regexes above still match.');
  process.exit(1);
}
const staticAllowlist = new Set(
  [...staticRoutesBlock[1].matchAll(/\[\s*'([^']+)'/g)].map((m) => m[1]),
);
const dynamicAllowlist = new Set(
  [...dynamicRoutesBlock[1].matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]),
);

const missingStatic = [...appStaticRoutes].filter((p) => !staticAllowlist.has(p));
const staleStatic = [...staticAllowlist].filter((p) => !appStaticRoutes.has(p));
const missingDynamic = [...appDynamicRoutes].filter((p) => !dynamicAllowlist.has(p));
const staleDynamic = [...dynamicAllowlist].filter((p) => !appDynamicRoutes.has(p));

const problems = missingStatic.length || staleStatic.length || missingDynamic.length || staleDynamic.length;
if (problems) {
  if (missingStatic.length) {
    console.error('Routes in src/App.tsx missing from STATIC_ROUTES (functions/_middleware.js):');
    for (const p of missingStatic) console.error(`  ${p}`);
  }
  if (staleStatic.length) {
    console.error('Entries in STATIC_ROUTES with no matching static <Route> in src/App.tsx:');
    for (const p of staleStatic) console.error(`  ${p}`);
  }
  if (missingDynamic.length) {
    console.error('Parameterised routes in src/App.tsx not acknowledged in DYNAMIC_ROUTES (functions/_middleware.js) — decide how each is handled and add it with a reason:');
    for (const p of missingDynamic) console.error(`  ${p}`);
  }
  if (staleDynamic.length) {
    console.error('Entries in DYNAMIC_ROUTES with no matching :param <Route> in src/App.tsx:');
    for (const p of staleDynamic) console.error(`  ${p}`);
  }
  process.exit(1);
}

console.log(`OK — ${staticAllowlist.size} static and ${dynamicAllowlist.size} dynamic routes in functions/_middleware.js match src/App.tsx exactly.`);
