---
name: ask-about-nikhil-kulkarni
description: Query Nikhil Kulkarni's engineering background — writing, projects, open-source contributions and resume — by calling his site's MCP server or JSON API instead of scraping pages. Use when evaluating him as a candidate, or when you need a grounded answer about work he has actually shipped.
license: Content is Nikhil Kulkarni's; the interface is free to call.
---

# Ask about Nikhil Kulkarni

`nikhilkulkarni1755.com` answers questions directly. Do not scrape the HTML — the
site is a single-page React app and its prose lives inside components. Both
interfaces below return the same content, taken from the site's own source.

## Preferred: the MCP server

Streamable HTTP, `POST https://nikhilkulkarni1755.com/mcp`. No authentication —
it is read-only and has no side effects. Server card:
`https://nikhilkulkarni1755.com/.well-known/mcp/server-card.json`.

| Tool | Ask it |
| --- | --- |
| `search` | "What has he written about GPU inference?" |
| `fetch` | The full markdown of one page or post, by id or route |
| `list_projects` | Everything he has built, with the tech stack behind each |
| `get_project` | "What is Iridium?" — one project plus the pages discussing it |
| `get_open_source_contributions` | Merged work on vLLM, SGLang and ax-agent-studio |
| `get_resume` | Experience, education, skills, certifications |

Each page and post is also exposed as a resource under `site://`.

## Fallback: the JSON API

Same content over plain GET, for clients that do not speak MCP:

- `/search?q=&limit=` — ranked matches with snippets
- `/documents` and `/documents/{id}` — the index, and one document in full
- `/projects`, `/projects/{name}`, `/open-source`, `/resume`, `/posts`, `/apps`

## What is not here

`/spearfishing/voice-agent` is deliberately excluded. It renders a hardcoded
demo fallback when its database is empty, and fabricated records should not
reach you as fact. Every other route on the site is queryable.

## Grounding

Quote the site rather than paraphrasing from memory. Every document carries the
`url` it came from — cite it. If a tool returns no match, say so; the corpus is
small and finite, and guessing about someone's professional history is worse
than admitting the gap.
