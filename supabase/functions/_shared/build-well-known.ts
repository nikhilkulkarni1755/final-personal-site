// Generates the discovery files from the MCP server's own tool definitions, so
// the published card can never advertise a tool the server does not serve.
// Run: deno run --allow-read --allow-write supabase/functions/_shared/build-well-known.ts
import { content } from './content.ts';
import { TOOLS } from './tools.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SITE = content.site;
const ENDPOINT = `${SITE}/mcp`;

const write = (rel: string, body: string) => {
  Deno.writeTextFileSync(ROOT + rel, body.endsWith('\n') ? body : body + '\n');
  console.log(`wrote ${rel} (${body.length} bytes)`);
};

// ── /.well-known/mcp/server-card.json ──
// Top-level name/description/version/serverUrl/tools[] are what ora's
// `mcp-server-card` check requires; serverInfo/capabilities/transport are the
// SEP-1649 shape isitagentready validates. Both are true of the same server.
write('public/.well-known/mcp/server-card.json', JSON.stringify({
  name: 'nikhilkulkarni1755-site',
  description:
    "Query Nikhil Kulkarni's engineering work — technical writing, projects and the " +
    'tech behind each, merged open-source contributions to vLLM and SGLang, and his ' +
    'resume. Read-only, unauthenticated.',
  version: content.generatedAt,
  serverUrl: ENDPOINT,
  websiteUrl: SITE,
  serverInfo: { name: 'nikhilkulkarni1755-site', version: content.generatedAt },
  transport: { type: 'streamable-http', endpoint: ENDPOINT },
  protocolVersion: '2026-07-28',
  authentication: { type: 'none' },
  capabilities: {
    tools: { listChanged: false },
    resources: { listChanged: false },
    prompts: false,
  },
  tools: TOOLS.map((t) => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
  })),
  resources: content.documents.map((d) => ({
    uri: `site://${d.id}`, name: d.title, mimeType: 'text/markdown',
  })),
}, null, 2));

// ── /.well-known/agent-skills/index.json ──
// Shape verified against isitagentready.com's own published index (R1 §1.5):
// {$schema, skills:[{name, type, description, url, digest}]}.
const SKILLS = [{
  name: 'ask-about-nikhil-kulkarni',
  path: 'public/.well-known/agent-skills/ask-about-nikhil-kulkarni/SKILL.md',
  description:
    "Query Nikhil Kulkarni's engineering background — writing, projects, open-source " +
    "contributions and resume — via his site's MCP server or JSON API instead of scraping.",
}];

const skills = await Promise.all(SKILLS.map(async (s) => {
  const body = Deno.readTextFileSync(ROOT + s.path);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return {
    name: s.name,
    type: 'skill-md',
    description: s.description,
    url: '/' + s.path.replace(/^public\//, ''),
    digest: 'sha256:' + Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}));

write('public/.well-known/agent-skills/index.json', JSON.stringify({
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills,
}, null, 2));
