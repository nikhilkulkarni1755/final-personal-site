// Generates the discovery files from the MCP server's own tool definitions, so
// the published card can never advertise a tool the server does not serve.
// Run: deno run --allow-read --allow-write supabase/functions/_shared/build-well-known.ts
import { content } from './content.ts';
import { getDocument } from './query.ts';
import { API_BASE, API_ROUTES, MCP_PATH } from './routes.ts';
import { TOOLS } from './tools.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SITE = content.site;
const ENDPOINT = `${SITE}${MCP_PATH}`;

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

// ── reachability check ──────────────────────────────────────────────────────
// A discovery file that advertises a path the site does not serve is worse than
// one that advertises nothing: an agent tries it, fails, and stops trusting the
// rest of the index. The nastiest case is silent — `/projects` is a real page,
// so asking it for JSON returns 200 with HTML and no signal anything is wrong.
// So paths are not merely checked for existence; they are checked for serving
// the kind of thing they were advertised as.

const norm = (p: string) => p.split('?')[0].replace(/\{[^}]*\}/g, '{}').replace(/\/$/, '') || '/';

const apiPaths = new Set([norm(API_BASE), ...Object.keys(API_ROUTES).map(
  (r) => norm(API_BASE + (r === '/' ? '' : r)))]);
// Real page routes on the site. voice-agent is a genuine page even though D4
// keeps it out of the corpus, so naming it is honest.
const pagePaths = new Set([...content.documents.map((d) => norm(d.route)),
  '/spearfishing/voice-agent']);
const fileExists = (p: string) => {
  try { return Deno.statSync(ROOT + 'public' + p).isFile; } catch { return false; }
};

const failures: string[] = [];
const checkPath = (raw: string, where: string, mustBeApi: boolean) => {
  const p = norm(raw);
  if (mustBeApi) {
    if (!apiPaths.has(p)) {
      failures.push(`${where}: "${raw}" is advertised as a JSON endpoint but ` +
        (pagePaths.has(p)
          ? `is a page route — it would return 200 with HTML. Prefix it with ${API_BASE}.`
          : `is not in API_ROUTES.`));
    }
    return;
  }
  if (p === norm(MCP_PATH) || apiPaths.has(p) || pagePaths.has(p) || fileExists(p)) return;
  failures.push(`${where}: "${raw}" resolves to nothing the site serves.`);
};

// Every path-ish token in SKILL.md, section by section, so an endpoint listed
// under the JSON API heading is held to the stricter rule.
const skillBody = Deno.readTextFileSync(ROOT + SKILLS[0].path);
for (const section of skillBody.split(/^## /m)) {
  const isApiSection = /^Fallback: the JSON API/.test(section);
  const found = new Set<string>();
  for (const m of section.matchAll(/`(\/[^`\s]*)`/g)) found.add(m[1]);
  for (const m of section.matchAll(/https:\/\/nikhilkulkarni1755\.com(\/[^\s`)]*)/g)) found.add(m[1]);
  for (const p of found) checkPath(p, `SKILL.md${isApiSection ? ' (JSON API section)' : ''}`, isApiSection);
}

// The card: its endpoint must be the proxied MCP path, and each resource URI
// must name a document the server can actually read back.
checkPath(new URL(ENDPOINT).pathname, 'server-card.serverUrl', false);
for (const r of content.documents) {
  if (!getDocument(r.id)) failures.push(`server-card.resources: site://${r.id} is unreadable.`);
}
// The skills index: each declared skill file must exist on disk.
for (const s of skills) if (!fileExists(s.url)) failures.push(`agent-skills: ${s.url} is missing.`);

if (failures.length) {
  console.error(`\n${failures.length} unreachable advertised path(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  Deno.exit(1);
}
console.log(`reachability OK — every advertised path resolves ` +
  `(${apiPaths.size} API routes, ${pagePaths.size} page routes, ${skills.length} skill file)`);
