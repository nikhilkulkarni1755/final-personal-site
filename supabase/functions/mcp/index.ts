// Remote MCP server for nikhilkulkarni1755.com — Streamable HTTP, spec revision
// 2026-07-28 (R1 §5.1: HTTP+SSE is deprecated; the GET stream and protocol-level
// sessions were removed in this revision).
//
// Read-only and unauthenticated by design: there is no user data and no side
// effects, so there is nothing to authorise (R1 §5.3).
import {
  content, getDocument, getProject, listDocuments, listProjects, openSource, search,
} from '../_shared/query.ts';

const LATEST = '2026-07-28';
// Older clients still speak sessions and the GET stream; we tolerate them by
// ignoring Mcp-Session-Id and Last-Event-ID rather than rejecting.
const SUPPORTED = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-protocol-version',
};

// DNS-rebinding defence: reject a present-but-unrecognised Origin (spec MUST).
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|anthropic\.com|chatgpt\.com|openai\.com|nikhilkulkarni1755\.com)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

type Id = string | number | null;
const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: Id, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) },
});

const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(status === 202 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...cors, ...extra,
      ...(status === 202 ? {} : { 'Content-Type': 'application/json' }),
      'MCP-Protocol-Version': LATEST,
    },
  });

// ── tools. Every one is backed by real site content; nothing is synthesised. ──
const TOOLS = [
  {
    name: 'search',
    title: "Search Nikhil Kulkarni's site",
    description:
      "Full-text search across every page and blog post on nikhilkulkarni1755.com — " +
      "technical writing, project write-ups, the resume page and engineering take-homes. " +
      "Returns ranked matches with a snippet; pass an id to `fetch` for the full text.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query, e.g. "disaggregated inference" or "MCP".' },
        limit: { type: 'integer', description: 'Maximum results (default 5, max 20).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch',
    title: 'Fetch a page or post in full',
    description:
      'Retrieve the complete text of one page or blog post as markdown. Accepts an id ' +
      'from `search` (e.g. "blog-matmul-to-ai") or a site route (e.g. "/about").',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Document id or site route.' } },
      required: ['id'],
    },
  },
  {
    name: 'list_projects',
    title: 'List projects and the tech behind each',
    description:
      'Every project Nikhil has built, with its description, tech stack, and links to ' +
      'source, demos or the live deployment. Optionally filter by technology.',
    inputSchema: {
      type: 'object',
      properties: {
        tech: { type: 'string', description: 'Filter, e.g. "Kubernetes", "MCP", "vLLM".' },
      },
    },
  },
  {
    name: 'get_project',
    title: 'Explain one project in depth',
    description:
      'One project in full, plus the pages and posts that discuss it. Use this to answer ' +
      '"what is Iridium?" or to go deeper on anything `list_projects` returned.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name, e.g. "Iridium" or "vLLM on EKS".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_open_source_contributions',
    title: 'Summarise open-source contributions',
    description:
      'Merged contributions to open-source inference and agent infrastructure — vLLM, ' +
      'SGLang and ax-agent-studio — with what each change did and a link to the pull requests.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_resume',
    title: 'Get experience, education and skills',
    description:
      'Structured professional history: roles and what was delivered in each, education, ' +
      'skills by area, and certifications.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

const RESOURCES = listDocuments().map((d) => ({
  uri: `site://${d.id}`,
  name: d.title,
  description: `${d.kind === 'post' ? 'Blog post' : 'Page'} at ${d.route} (${d.chars} characters).`,
  mimeType: 'text/markdown',
}));

function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'search': {
      const query = String(args.query ?? '');
      if (!query.trim()) throw new Error('query is required');
      const limit = Math.min(Number(args.limit) || 5, 20);
      return { results: search(query, limit) };
    }
    case 'fetch': {
      const doc = getDocument(String(args.id ?? ''));
      if (!doc) {
        throw new Error(
          `no document "${args.id}". Available ids: ${listDocuments().map((d) => d.id).join(', ')}`);
      }
      return {
        id: doc.id, title: doc.title, url: doc.url, text: doc.text,
        metadata: { route: doc.route, kind: doc.kind, tags: doc.tags, date: doc.date },
      };
    }
    case 'list_projects':
      return { projects: listProjects(args.tech ? String(args.tech) : undefined) };
    case 'get_project': {
      const found = getProject(String(args.name ?? ''));
      if (!found) {
        throw new Error(
          `no project "${args.name}". Available: ${content.projects.map((p) => p.title).join(', ')}`);
      }
      return found;
    }
    case 'get_open_source_contributions':
      return openSource();
    case 'get_resume':
      return content.resume;
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

function handle(msg: Record<string, unknown>, headers: Headers) {
  const id = (msg.id ?? null) as Id;
  const method = String(msg.method ?? '');
  const params = (msg.params ?? {}) as Record<string, unknown>;

  // Header/body agreement is mandatory in 2026-07-28; absent headers mean an
  // older client, which is allowed.
  const hMethod = headers.get('mcp-method');
  if (hMethod && hMethod !== method) {
    return err(id, -32020, 'HeaderMismatch', { header: 'Mcp-Method', expected: method });
  }

  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? LATEST);
      return ok(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: {
          name: 'nikhilkulkarni1755-site',
          title: "Nikhil Kulkarni's site",
          version: content.generatedAt,
          websiteUrl: content.site,
        },
        instructions:
          "Ask about Nikhil Kulkarni's engineering work. `search` then `fetch` for anything " +
          'written; `list_projects` and `get_project` for what he has built and the tech behind ' +
          'it; `get_open_source_contributions` for merged work on vLLM and SGLang; `get_resume` ' +
          'for experience, education and skills.',
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'resources/list':
      return ok(id, { resources: RESOURCES });
    case 'resources/read': {
      const uri = String(params.uri ?? '');
      const hName = headers.get('mcp-name');
      if (hName && hName !== uri) {
        return err(id, -32020, 'HeaderMismatch', { header: 'Mcp-Name', expected: uri });
      }
      const doc = getDocument(uri.replace(/^site:\/\//, ''));
      if (!doc) return err(id, -32602, `Unknown resource: ${uri}`);
      return ok(id, { contents: [{ uri, mimeType: 'text/markdown', text: doc.text }] });
    }
    case 'tools/call': {
      const name = String(params.name ?? '');
      const hName = headers.get('mcp-name');
      if (hName && hName !== name) {
        return err(id, -32020, 'HeaderMismatch', { header: 'Mcp-Name', expected: name });
      }
      if (!TOOLS.some((t) => t.name === name)) return err(id, -32602, `Unknown tool: ${name}`);
      try {
        const result = callTool(name, (params.arguments ?? {}) as Record<string, unknown>);
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (e) {
        // Tool failures are reported in-band so the model can recover.
        return ok(id, {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        });
      }
    }
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const origin = req.headers.get('origin');
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    return new Response('Forbidden origin', { status: 403, headers: cors });
  }

  // 2026-07-28 removed the standalone GET stream; a server on this revision
  // answers anything but POST with 405.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify(err(null, -32600, 'Use POST for Streamable HTTP')), {
      status: 405,
      headers: { ...cors, Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' },
    });
  }

  const version = req.headers.get('mcp-protocol-version');
  if (version && !SUPPORTED.includes(version)) {
    return reply(err(null, -32600, `Unsupported MCP-Protocol-Version: ${version}`, { supported: SUPPORTED }), 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(err(null, -32700, 'Parse error'), 400);
  }

  // A batch is allowed by JSON-RPC; notifications carry no id and get 202.
  const messages = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
  const responses = messages
    .filter((m) => m && m.id !== undefined && m.id !== null)
    .map((m) => handle(m, req.headers));

  if (!responses.length) return reply(null, 202);
  return reply(Array.isArray(body) ? responses : responses[0]);
});
