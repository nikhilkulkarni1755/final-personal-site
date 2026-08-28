# AGENTS.md

Instructions for coding agents (and a map for content/crawling agents) working with
this repository: https://github.com/nikhilkulkarni1755/final-personal-site

## What this is

Nikhil Kulkarni's personal site and portfolio — a Vite + React 19 + TypeScript SPA,
deployed to Cloudflare Pages at https://nikhilkulkarni1755.com. Routing is
`react-router-dom` (`BrowserRouter`) for client-side navigation, styling is Tailwind
CSS v4, data persistence for page-view/like counters is Supabase.

Production builds also prerender: `scripts/prerender.mjs` drives real headless
Chromium over the built `dist/` and writes each of the 11 real routes (every route
except `/spearfishing/voice-agent`, see "no stub data" below) out as its own static
`dist/<route>/index.html`, with `src/data/routeMeta.ts`'s title/description/canonical/
OG/Twitter/JSON-LD injected into that file directly. Cloudflare Pages then serves
those as real static assets — an AI crawler or a social-share scraper gets real
per-route HTML and JSON-LD without executing JS. `public/_redirects`' `/* /index.html
200` rule is not what makes unprerendered paths (a mistyped URL, `/spearfishing/
voice-agent`) resolve — Cloudflare Pages logs that rule as an ignored infinite loop at
deploy time and never runs it; the actual fallback for any path with no matching
static asset is Cloudflare Pages' own built-in "no asset, no 404.html => serve
index.html" behavior.

## Build and verify

- `npm run dev` — local dev server
- `npm run build` — `tsc -b && vite build && npm run prerender`; must pass with zero
  type errors, and the prerender step runs `scripts/prerender-verify.mjs` assertions
  (one JSON-LD block and one canonical per prerendered route, etc.) before it's
  considered done. All of this must pass before any commit.
- `npm run lint` — ESLint
- `npm run preview` — serve the production build locally (prerendered files included)

Building requires Node 22.18+ and a working Chromium (the prerender step launches one
via Playwright, currently pinned to `playwright@1.60.0`). Version pinning for Node
itself (an `engines` field / `.nvmrc`) is landing separately; once it does, this line
should name the exact pinned version instead of a floor.

## Where content lives

- `src/pages/*.tsx` — each route's real content. Prose-heavy pages (blog posts, About,
  the Fireworks AI writeup, the Weave take-home) are hand-written JSX, not pulled from
  a CMS or Markdown file.
- `src/data/*.json` — structured records: `projects.json`, `blogs.json` (title/slug/tags
  only — `content` is intentionally empty; the real post bodies are the dedicated
  `.tsx` pages under `src/pages`, not this file), `apps.json`, `contributions.json`,
  `social.json`.
- `src/data/routeMeta.ts` — the single source of truth for per-route `<title>`,
  description, canonical URL, Open Graph/Twitter tags, and JSON-LD. `scripts/
  prerender.mjs` reads this file and injects its values into each route's static HTML
  at build time (see "What this is" above) — this is implemented, not aspirational.
  Adding a route to `src/App.tsx` without adding a matching entry here will ship that
  route with no metadata.

## A hard rule: no stub data

Nothing in this repo ships fabricated placeholder content as if it were real (no lorem
ipsum, no mock records presented as live data). `/spearfishing/voice-agent` is the one
known exception to watch: `src/hooks/useMarketplace.tsx` falls back to a hardcoded
`MOCK_DRUGS` array when its Supabase table is empty, and that page is deliberately
excluded from the site's structured metadata, sitemap, and any agent-facing content
export for exactly that reason. If you fix that fallback, remove the exclusion; if you
add a new stub anywhere else, don't ship it without a matching real-data guarantee.

## Conventions

- Every code change should be minimal and reuse existing patterns rather than
  introducing a parallel one (see the per-route `RouteMeta` type in `routeMeta.ts` for
  the level of consistency expected of new data-shaped files).
- No new employer names, dates, or credentials get added to `About.tsx` or
  `routeMeta.ts` without a real, traceable source — this is a hiring site.
