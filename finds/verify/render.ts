/**
 * Rendering a JS-only page, for the cases where a plain GET returns a shell.
 *
 * R2 §3.6: "Site is entirely JS-rendered, HTML shell is empty -> ALLOW per
 * robots; render with Playwright under the same UA and the same rate limit.
 * Rendering is not a permission question." And §5.3: render and read only --
 * no click, no type, no submit, no scroll-to-load.
 *
 * WHAT WENT WRONG BEFORE, AND WHAT THIS NOW ENFORCES (D21/C2). This module
 * used to take a bare URL and call page.goto() on it. It imported no gate, so
 * a browser navigation -- which is a fetch, under our published User-Agent --
 * went out with no robots check, no scope check, no delay and no cap. Worse, a
 * rendered page can steer the browser: a redirect, a meta refresh, a script
 * setting location, an iframe or an XHR can name any host it likes, so the
 * SSRF surface that P1 closes for candidate URLs was wide open here.
 *
 * Three rules now, and they are structural rather than advisory:
 *
 *   1. renderPage cannot be called without an ALLOW decision. It takes the
 *      GateDecision, not a URL, so there is no signature that renders an
 *      ungated page.
 *   2. Every request the browser attempts is checked against that decision's
 *      authority and ABORTED if it does not match. Not a filter on known-bad
 *      hosts -- an allowlist of exactly one origin. A page cannot reach
 *      169.254.169.254, or anywhere else, because it cannot reach anything
 *      that is not the origin the gate already ruled on.
 *   3. Only the document we were allowed to fetch may be a document request.
 *      A same-origin navigation to another path is still a page we have no
 *      verdict for, so it is aborted too.
 *
 * WHAT THIS DOES NOT DO, stated plainly because the coordinator should decide
 * whether it is enough: same-origin subresources (scripts, XHR) are allowed
 * without their own robots.txt path check. Putting each one through the gate
 * would mean a gate request per subresource -- the browser would issue dozens
 * -- which costs the very budget this fix exists to protect. The trade is:
 * every byte comes from the one authority the gate cleared, images/media/
 * fonts/stylesheets are refused per R2 §5.3's content-type allowlist, the
 * whole render counts against the request cap, and what it contacted is
 * recorded. If that trade is not acceptable, the render path should be
 * dropped rather than loosened.
 *
 * Playwright is resolved at runtime rather than imported, so a machine without
 * it records an unrendered shell as an unrendered shell instead of failing.
 */

import { R2_CAPS, USER_AGENT } from './config.ts';
import type { GateDecision } from './types.ts';

/** R2 §5.3: these content types are never fetched, browser or not. */
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

export interface RenderResult {
  html: string;
  /** Requests allowed through, all of them same-origin. */
  subresources: number;
  /** Refused because they left the gated origin. The SSRF counter. */
  blockedOffOrigin: string[];
  /** Refused for content type, or for being an unverdicted navigation. */
  blockedOther: number;
}

interface ChromiumLike {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
}
interface BrowserLike {
  newContext(options: Record<string, unknown>): Promise<ContextLike>;
  close(): Promise<void>;
}
interface ContextLike {
  route(pattern: string, handler: (route: RouteLike) => unknown): Promise<void>;
  newPage(): Promise<PageLike>;
}
interface RouteLike {
  request(): { resourceType(): string; url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
interface PageLike {
  goto(url: string, options: Record<string, unknown>): Promise<unknown>;
  content(): Promise<string>;
}

async function chromium(): Promise<ChromiumLike> {
  const specifier = process.env.FINDS_PLAYWRIGHT_MODULE ?? 'playwright';
  const mod = (await import(specifier)) as Record<string, unknown>;
  const root = (mod.default ?? mod) as Record<string, unknown>;
  const browser = root.chromium as ChromiumLike | undefined;
  if (!browser) throw new Error(`${specifier} exports no chromium`);
  return browser;
}

/**
 * Decide one browser request, with no network access of its own.
 *
 * Exported so the rule can be tested without launching a browser -- the
 * property that matters is that nothing off-origin is ever allowed, and that
 * is a pure function of the URL.
 */
export function routeVerdict(
  requestUrl: string,
  resourceType: string,
  allowedUrl: string,
  allowedAuthority: string,
): 'allow' | 'off-origin' | 'blocked-type' | 'unverdicted-navigation' {
  let origin: string;
  try {
    const parsed = new URL(requestUrl);
    // data:, blob:, about: and friends have no origin to compare and no
    // business being fetched.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'off-origin';
    origin = parsed.origin;
  } catch {
    return 'off-origin';
  }
  if (origin !== allowedAuthority) return 'off-origin';
  if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return 'blocked-type';
  // Only the page the gate ruled on may be loaded as a document. Any other
  // navigation is a page we hold no verdict for.
  if (resourceType === 'document' && requestUrl !== allowedUrl) return 'unverdicted-navigation';
  return 'allow';
}

/**
 * Render a page the gate has already allowed, and return its DOM.
 *
 * Takes the decision rather than a URL so that an ungated render is not
 * expressible. Reads; never acts.
 */
export async function renderPage(decision: GateDecision): Promise<RenderResult> {
  if (!decision.allowed) {
    throw new Error(
      `renderPage was given a DENY verdict for ${decision.url} (${decision.reason_code}). ` +
        'A browser navigation is a fetch and this path does not make them without an ALLOW.',
    );
  }
  const allowedUrl = decision.url;
  const allowedAuthority = decision.authority;

  const browser = await (await chromium()).launch({ headless: true });
  const blockedOffOrigin: string[] = [];
  let subresources = 0;
  let blockedOther = 0;
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      extraHTTPHeaders: { 'Accept-Language': 'en' },
      javaScriptEnabled: true,
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const verdict = routeVerdict(request.url(), request.resourceType(), allowedUrl, allowedAuthority);
      if (verdict === 'allow') {
        subresources += 1;
        await route.continue();
        return;
      }
      if (verdict === 'off-origin') blockedOffOrigin.push(request.url());
      else blockedOther += 1;
      await route.abort();
    });
    const page = await context.newPage();
    await page.goto(allowedUrl, { waitUntil: 'networkidle', timeout: R2_CAPS.totalTimeoutMs });
    return { html: await page.content(), subresources, blockedOffOrigin, blockedOther };
  } finally {
    await browser.close();
  }
}
