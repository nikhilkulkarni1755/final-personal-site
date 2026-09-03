# Interesting Finds Bot

Last updated: August 28, 2026

## Who operates it

I'm Nikhil Kulkarni, and I operate this bot myself for my own personal site, [nikhilkulkarni1755.com](https://nikhilkulkarni1755.com) . One person's pipeline -- not a company, and not a third-party crawling service.

## What it does, and why

Every day this pipeline pulls a short list of newly-launched products from public sources (Peerlist, Show HN, GitHub, and similar). For each one it reads the product's own homepage and a handful of sub-pages -- pricing, docs, about -- to check whether what it advertises is actually true, whether it solves a real problem, whether anyone can use it, and whether it is agent/MCP friendly. Only products that pass get published, by hand, on [Interesting Finds](/interesting-finds) with a link back to the maker's own site. Nothing this bot reads is used to train a model.

## User-Agent and how to block it

Sent byte-for-byte on every request this bot makes, robots.txt included:

```
InterestingFindsBot/1.0 (+https://nikhilkulkarni1755.com/bot.txt)
```

Releases bump only the version number -- the product token never changes, and a second User-Agent is never sent after a block. To keep it out entirely, add this to your robots.txt:

```
User-agent: InterestingFindsBot
Disallow: /
```

robots.txt is re-read on every run, so a block takes effect on the very next visit.

## What it will not do

- • GET and HEAD requests only -- never POST, PUT, PATCH, or DELETE
- • Never logs in, signs up, checks out, or submits a form
- • Never sends a cookie, an Authorization header, or an API key
- • Never spoofs a browser User-Agent or claims to be anything else
- • At most 25 pages per site, at least 2 seconds apart

## Signals it honours

robots.txt (including `Crawl-delay`), `X-Robots-Tag`, `<meta name="robots">`, `Content-Signal`, `Content-Usage`, and TDM-reservation headers. When a site's own signals say no, this bot does not fetch that page. Full stop.

## Opt out or complain

Email [nikhilkulkarni1755@gmail.com](mailto:nikhilkulkarni1755@gmail.com) . Any request lands your domain on a permanent denylist, no argument -- in addition to, not instead of, an ordinary robots.txt block.

Also available as plain text at [/bot.txt](/bot.txt) -- the version a script actually reads.
