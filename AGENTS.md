# AGENTS.md

Instructions for coding agents (and a map for content/crawling agents) working with
this repository: https://github.com/nikhilkulkarni1755/final-personal-site

## What this is

Nikhil Kulkarni's personal site and portfolio — a Vite + React 19 + TypeScript SPA,
deployed to Cloudflare Pages at https://nikhilkulkarni1755.com. Routing is
`react-router-dom` (`BrowserRouter`), styling is Tailwind CSS v4, data persistence for
page-view/like counters is Supabase.

## Build and verify

- `npm run dev` — local dev server
- `npm run build` — `tsc -b && vite build`; must pass with zero type errors before any
  commit
- `npm run lint` — ESLint
- `npm run preview` — serve the production build locally

## Where content lives

- `src/pages/*.tsx` — each route's real content. Prose-heavy pages (blog posts, About,
  the Fireworks AI writeup, the Weave take-home) are hand-written JSX, not pulled from
  a CMS or Markdown file.
- `src/data/*.json` — structured records: `projects.json`, `blogs.json` (title/slug/tags
  only — `content` is intentionally empty; the real post bodies are the dedicated
  `.tsx` pages under `src/pages`, not this file), `apps.json`, `contributions.json`,
  `social.json`.
- `src/data/routeMeta.ts` — the single source of truth for per-route `<title>`,
  description, canonical URL, Open Graph/Twitter tags, and JSON-LD. Adding a route to
  `src/App.tsx` without adding a matching entry here will ship that route with no
  metadata.

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
