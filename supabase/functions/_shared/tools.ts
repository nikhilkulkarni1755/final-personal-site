// ── tools. Every one is backed by real site content; nothing is synthesised. ──
// Tool definitions live here, not in the server, so the published server card
// is generated from the same array the server serves. They cannot drift.
export const TOOLS = [
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
