// Edge request handling for nikhilkulkarni1755.com (Cloudflare Pages Functions).
// Runs before public/_redirects, which otherwise rewrites every path to
// /index.html 200 (the SPA shell) — the reason agents can't tell a real route
// from a typo. This file's job: keep that fallback for real client routes,
// and return a genuine 404 for everything else.

import blogs from '../src/data/blogs.json';

// Extensionless paths the client-side router (src/App.tsx) actually renders.
const STATIC_ROUTES = new Set([
  '/',
  '/projects',
  '/blog',
  '/apps',
  '/about',
  '/privacy-policy',
  '/spearfishing/voice-agent',
  '/spearfishing/fireworks-ai',
  '/take-homes/weave',
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

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);

  // No dot in the last segment => this looks like a client-side route, not a
  // file request. Reject it up front if it's not one src/App.tsx defines, so
  // agents guessing paths get a real 404 instead of the SPA shell.
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  const looksLikeRoute = !lastSegment.includes('.');
  if (looksLikeRoute && !isKnownRoute(pathname)) {
    return notFound();
  }

  // Otherwise defer to normal static asset resolution — real files
  // (including anything W1/W2/W4 add later) are served as-is. A path that
  // looked like a file request but still fell through to the SPA shell
  // (_redirects' /* /index.html 200) means nothing real is there either;
  // known routes always resolve to genuine HTML, so this only catches
  // guessed/nonexistent file paths.
  const response = await context.next();
  if (!looksLikeRoute && response.status === 200) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return notFound();
    }
  }
  return response;
}
