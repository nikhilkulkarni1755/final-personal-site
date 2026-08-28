// Edge request handling for nikhilkulkarni1755.com (Cloudflare Pages Functions).
// Runs before public/_redirects, which otherwise rewrites every path to
// /index.html 200 (the SPA shell) — the reason agents can't tell a real route
// from a typo. This file's job: keep that fallback for real client routes,
// and return a genuine 404 for everything else.

import blogs from '../src/data/blogs.json';

// Extensionless paths the client-side router (src/App.tsx) actually renders,
// with a short title for each — reused below both for 404 knowledge and for
// the ?mode=agent page list.
const STATIC_ROUTES = new Map([
  ['/', 'Home'],
  ['/projects', 'Projects'],
  ['/blog', 'Blog'],
  ['/apps', 'Apps'],
  ['/about', 'About'],
  ['/privacy-policy', 'Privacy policy'],
  ['/spearfishing/voice-agent', 'Live demo: voice-driven marketplace agent'],
  ['/spearfishing/fireworks-ai', 'Project writeup: Fireworks AI'],
  ['/take-homes/weave', 'Take-home: Weave'],
]);

const BLOG_SLUGS = new Set(blogs.map((post) => post.slug));

function isKnownRoute(pathname) {
  if (STATIC_ROUTES.has(pathname)) return true;
  const blogSlug = pathname.match(/^\/blog\/([^/]+)$/);
  return blogSlug ? BLOG_SLUGS.has(blogSlug[1]) : false;
}

const NOT_FOUND_BODY = `# 404 Not Found

This path doesn't exist on nikhilkulkarni1755.com.

- [Sitemap](/sitemap.xml)
- [llms.txt](/llms.txt)
- [Home](/)
`;

function notFound() {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
}

// W2's path contract (agent-ready-coord/lanes/W2.md): every route's markdown
// twin lives at the same path with .md appended, homepage excepted.
function markdownPathFor(pathname) {
  return pathname === '/' ? '/index.md' : `${pathname}.md`;
}

// Collapse the alternate spellings of a route (Cloudflare's own /index.html
// suffix and trailing slashes) down to the canonical form STATIC_ROUTES and
// BLOG_SLUGS are keyed on. "/index.html" -> "/", "/about/" -> "/about",
// "/about/index.html" -> "/about" (the shape W1's per-route prerendered
// files will have on disk). Anything else passes through unchanged.
function canonicalRoute(pathname) {
  let route = pathname;
  if (route.endsWith('/index.html')) {
    route = route.slice(0, -'index.html'.length);
  }
  if (route.length > 1 && route.endsWith('/')) {
    route = route.slice(0, -1);
  }
  return route || '/';
}

// ora `agent-mode-view`: "a structured, machine-readable view with API
// endpoints, authentication info, and key capabilities instead of marketing
// HTML." Pages listed here are the real STATIC_ROUTES map plus blog posts
// pulled from the same src/data/blogs.json src/App.tsx renders from —
// nothing here is invented.
function agentModeView() {
  const pages = [...STATIC_ROUTES.entries()].map(([path, title]) => ({ path, title }));
  for (const post of blogs) {
    pages.push({ path: `/blog/${post.slug}`, title: post.title });
  }
  const body = {
    site: 'Nikhil Kulkarni',
    description:
      'Software Engineer building AI agents in production. Creator of Iridium, an MCP server giving AI agents real access to LinkedIn. Agent orchestration, MCP tooling, and cloud infrastructure. Contributor to vLLM and SGLang.',
    authentication: 'none — every page here is public, no API key required',
    content_negotiation:
      'Send Accept: text/markdown to any page path below for a machine-readable version.',
    endpoints: {
      sitemap: '/sitemap.xml',
      llms_txt: '/llms.txt',
      llms_full_txt: '/llms-full.txt',
    },
    pages,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function withVary(response) {
  const headers = new Headers(response.headers);
  const existing = headers.get('vary');
  headers.set('vary', existing ? `${existing}, Accept` : 'Accept, Accept-Encoding');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/' && url.searchParams.get('mode') === 'agent') {
    return agentModeView();
  }

  // Resolve alternate spellings (/index.html, trailing slash) to the same
  // canonical route before deciding what this request is. No dot in the
  // canonical form's last segment => this looks like a client-side route,
  // not a file request. Reject it up front if it's not one src/App.tsx
  // defines, so agents guessing paths get a real 404 instead of the SPA
  // shell.
  const canonical = canonicalRoute(pathname);
  const lastSegment = canonical.slice(canonical.lastIndexOf('/') + 1);
  const looksLikeRoute = !lastSegment.includes('.');
  if (looksLikeRoute && !isKnownRoute(canonical)) {
    return notFound();
  }

  if (looksLikeRoute) {
    // Markdown content negotiation: an agent asking for text/markdown gets
    // W2's hand-written .md twin for this route, if one exists yet. Falls
    // through to the normal HTML response otherwise (pre-launch, or routes
    // W2 excludes, e.g. /spearfishing/voice-agent's live-Supabase page).
    if ((request.headers.get('accept') || '').includes('text/markdown')) {
      const mdUrl = new URL(markdownPathFor(canonical), request.url);
      const mdResponse = await env.ASSETS.fetch(new Request(mdUrl, request));
      // env.ASSETS.fetch bypasses this middleware, so a missing .md file
      // falls through _redirects to the SPA shell (200, text/html) rather
      // than a real 404 — check for that instead of trusting mdResponse.ok.
      const mdContentType = mdResponse.headers.get('content-type') || '';
      if (mdResponse.ok && !mdContentType.includes('text/html')) {
        const headers = new Headers(mdResponse.headers);
        headers.set('content-type', 'text/markdown; charset=utf-8');
        headers.set('vary', 'Accept, Accept-Encoding');
        return new Response(mdResponse.body, { status: 200, headers });
      }
    }
    return withVary(await context.next());
  }

  // Otherwise defer to normal static asset resolution — real files
  // (including anything W1/W2/W4 add later) are served as-is. A path that
  // looked like a file request but still fell through to the SPA shell
  // (_redirects' /* /index.html 200) means nothing real is there either;
  // known routes always resolve to genuine HTML, so this only catches
  // guessed/nonexistent file paths.
  const response = await context.next();
  if (response.status === 200) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return notFound();
    }
  }
  return response;
}
