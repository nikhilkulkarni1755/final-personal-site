// Query layer over the generated corpus. Shared by the REST API (site-api) and
// the MCP server (mcp) so both answer from exactly the same content.
import { content } from './content.ts';

type Doc = (typeof content.documents)[number];

const norm = (s: string) => s.toLowerCase();
// Common words match everything and let the longest document win on noise alone.
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'was', 'are',
  'has', 'have', 'his', 'her', 'you', 'what', 'how', 'why', 'who', 'does', 'did', 'can',
  'about', 'into', 'out', 'not', 'but', 'all', 'any', 'some', 'more', 'than', 'then',
  'they', 'them', 'their', 'there', 'been', 'were', 'would', 'should', 'could']);
const terms = (q: string) => {
  const all = norm(q).split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1);
  const kept = all.filter((t) => !STOP.has(t));
  return kept.length ? kept : all;
};

const isWordChar = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);

/** Whole-word occurrences. Substring matching would score "multi" against
 *  "multiplied" and hand every query to the longest essay. */
function countOf(haystack: string, term: string): number {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(term, i)) !== -1) {
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[i + term.length])) n++;
    i += term.length;
  }
  return n;
}

/** Best-matching window of prose around the query terms, trimmed to word edges. */
function snippet(text: string, ts: string[], width = 320): string {
  const hay = norm(text);
  let at = -1;
  for (const t of ts) {
    const i = hay.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return text.slice(0, width).trim();
  const start = Math.max(0, at - Math.floor(width / 3));
  const raw = text.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + raw + (start + width < text.length ? '…' : '');
}

export interface SearchHit {
  id: string; title: string; url: string; route: string; kind: string;
  score: number; snippet: string;
}

export function search(query: string, limit = 5): SearchHit[] {
  const ts = terms(query);
  if (!ts.length) return [];
  const hits: SearchHit[] = [];
  for (const d of content.documents) {
    const body = norm(d.text), title = norm(d.title);
    const tags = norm((d.tags ?? []).join(' '));
    let score = 0;
    for (const t of ts) {
      // Body hits are normalised by document length so a 17k-char essay does not
      // outrank a precise short page just by being long.
      score += countOf(title, t) * 12 + countOf(tags, t) * 6 +
        countOf(body, t) / Math.sqrt(d.text.length / 1000);
    }
    if (ts.length > 1 && body.includes(ts.join(' '))) score += 15; // exact phrase
    score = Math.round(score * 10) / 10;
    if (score > 0) {
      hits.push({
        id: d.id, title: d.title, url: d.url, route: d.route, kind: d.kind,
        score, snippet: snippet(d.text, ts),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Accepts a document id ("blog-matmul-to-ai") or a route ("/blog/matmul-to-ai"). */
export function getDocument(idOrRoute: string): Doc | undefined {
  const key = idOrRoute.trim().replace(/\/+$/, '') || '/';
  return content.documents.find((d) => d.id === key || d.route === key);
}

export function listDocuments() {
  return content.documents.map((d) => ({
    id: d.id, route: d.route, url: d.url, title: d.title, kind: d.kind,
    tags: d.tags, date: d.date, chars: d.text.length,
  }));
}

export function listProjects(tech?: string) {
  if (!tech) return content.projects;
  const t = norm(tech);
  return content.projects.filter((p) =>
    p.techStack.some((s) => norm(s).includes(t)) ||
    norm(p.title).includes(t) || norm(p.description).includes(t));
}

/** Named project lookup, plus any page prose that discusses it (e.g. Iridium). */
export function getProject(name: string) {
  const n = norm(name);
  const project = content.projects.find((p) => norm(p.title) === n) ??
    content.projects.find((p) => norm(p.title).includes(n));
  if (!project) return undefined;
  const mentions = search(project.title, 3)
    .filter((h) => h.kind !== 'page' || h.route !== '/projects');
  return { project, alsoDiscussedIn: mentions };
}

export function openSource() {
  return {
    contributions: content.contributions,
    totalMergedPullRequests: content.contributions.reduce((n, c) => n + c.merged, 0),
    profile: content.owner.links.find((l) => l.name === 'GitHub')?.url,
  };
}

export { content };
