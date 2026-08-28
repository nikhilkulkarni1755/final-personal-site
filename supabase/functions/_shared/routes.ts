// The site's public HTTP contract, in one place. W5's Pages Function
// (functions/_middleware.js) reverse-proxies exactly two prefixes onto these
// Supabase edge functions; anything advertised outside them does not resolve.
// Per D11 the proxy is what lets the server card name nikhilkulkarni1755.com.
export const MCP_PATH = '/mcp';
export const API_BASE = '/api';

/** Paths are relative to API_BASE. The site-api function serves these, and
 *  build-well-known.ts checks every advertised endpoint against this table. */
export const API_ROUTES: Record<string, string> = {
  '/': 'this index',
  '/search?q=&limit=': 'full-text search across every page and post',
  '/documents': 'every indexed page and post, with metadata',
  '/documents/{id}': 'one document in full, as markdown text',
  '/projects?tech=': 'projects, optionally filtered by technology',
  '/projects/{name}': 'one project plus the pages that discuss it',
  '/open-source': 'merged contributions to vLLM, SGLang and ax-agent-studio',
  '/resume': 'experience, education, skills and certifications',
  '/posts': 'blog posts with dates, tags and read times',
  '/apps': 'shipped applications',
};

/** Public form of the table, i.e. what an agent should actually request. */
export const publicApiRoutes = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(API_ROUTES).map(([p, d]) => [API_BASE + (p === '/' ? '' : p), d]),
  );
