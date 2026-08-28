// Queryable JSON API over nikhilkulkarni1755.com's own content.
// Read-only, unauthenticated, CORS-open — there is no user data and no side effects.
import {
  content, getDocument, getProject, listDocuments, listProjects, openSource, search,
} from '../_shared/query.ts';
import { publicApiRoutes } from '../_shared/routes.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600' },
  });


Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  // Supabase serves this at /functions/v1/site-api/*; strip that prefix.
  const path = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/site-api/, '')
    .replace(/\/+$/, '') || '/';

  switch (true) {
    case path === '/':
      return json({
        name: 'nikhilkulkarni1755.com content API',
        description:
          "Read-only access to Nikhil Kulkarni's writing, projects and open-source work.",
        owner: content.owner,
        generatedAt: content.generatedAt,
        counts: {
          documents: content.documents.length, projects: content.projects.length,
          posts: content.posts.length, contributions: content.contributions.length,
        },
        endpoints: publicApiRoutes(),
        mcp: `${content.site}/.well-known/mcp/server-card.json`,
      });

    case path === '/search': {
      const q = url.searchParams.get('q');
      if (!q) return json({ error: 'missing_query', hint: 'pass ?q=' }, 400);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 5, 20);
      return json({ query: q, results: search(q, limit) });
    }

    case path === '/documents':
      return json({ documents: listDocuments() });

    case path.startsWith('/documents/'): {
      const doc = getDocument(decodeURIComponent(path.slice('/documents/'.length)));
      return doc ? json(doc) : json({ error: 'not_found', available: listDocuments().map((d) => d.id) }, 404);
    }

    case path === '/projects':
      return json({ projects: listProjects(url.searchParams.get('tech') ?? undefined) });

    case path.startsWith('/projects/'): {
      const found = getProject(decodeURIComponent(path.slice('/projects/'.length)));
      return found ? json(found)
        : json({ error: 'not_found', available: content.projects.map((p) => p.title) }, 404);
    }

    case path === '/open-source':
      return json(openSource());

    case path === '/resume':
      return json(content.resume);

    case path === '/posts':
      return json({ posts: content.posts });

    case path === '/apps':
      return json({ apps: content.apps });

    default:
      return json({ error: 'not_found', endpoints: publicApiRoutes() }, 404);
  }
});
