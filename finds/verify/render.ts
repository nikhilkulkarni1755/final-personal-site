/**
 * Rendering a JS-only page, for the cases where a plain GET returns a shell.
 *
 * R2 §3.6: "Site is entirely JS-rendered, HTML shell is empty -> ALLOW per
 * robots; render with Playwright under the same UA and the same rate limit.
 * Rendering is not a permission question." And §5.3: render and read only --
 * no click, no type, no submit, no scroll-to-load. This module does exactly
 * that and nothing else. It is only ever called for a URL the gate has
 * already allowed and that a plain GET has already reached.
 *
 * A browser fetches subresources the crawler would never ask for, so images,
 * media, fonts and stylesheets are refused at the route level (R2 §5.3:
 * those content types are never fetched). What the page did contact is
 * recorded, so a render is as auditable as a fetch.
 *
 * Playwright is resolved at runtime rather than declared in package.json.
 * Adding a browser download to the dependency list of Nikhil's personal site
 * is a call for the coordinator, not this lane, and the crawler degrades
 * honestly without it: an unrendered shell is recorded as an unrendered
 * shell, never as a page with no content.
 */

import { R2_CAPS, USER_AGENT } from './config.ts';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

export interface RenderResult {
  html: string;
  /** Distinct origins the page contacted while rendering. */
  contactedOrigins: string[];
  blockedSubresources: number;
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

/**
 * `playwright` is not a dependency of this repo. FINDS_PLAYWRIGHT_MODULE points
 * at an installation; without it this throws and the caller records that the
 * page could not be rendered.
 */
async function chromium(): Promise<ChromiumLike> {
  const specifier = process.env.FINDS_PLAYWRIGHT_MODULE ?? 'playwright';
  const mod = (await import(specifier)) as Record<string, unknown>;
  const root = (mod.default ?? mod) as Record<string, unknown>;
  const browser = root.chromium as ChromiumLike | undefined;
  if (!browser) throw new Error(`${specifier} exports no chromium`);
  return browser;
}

/** Render one already-allowed URL and return its DOM. Reads; never acts. */
export async function renderPage(url: string): Promise<RenderResult> {
  const browser = await (await chromium()).launch({ headless: true });
  const contactedOrigins = new Set<string>();
  let blockedSubresources = 0;
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      extraHTTPHeaders: { 'Accept-Language': 'en' },
      javaScriptEnabled: true,
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        blockedSubresources += 1;
        await route.abort();
        return;
      }
      try {
        contactedOrigins.add(new URL(request.url()).origin);
      } catch {
        // A data: or blob: URL has no origin worth recording.
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: R2_CAPS.totalTimeoutMs });
    return { html: await page.content(), contactedOrigins: [...contactedOrigins], blockedSubresources };
  } finally {
    await browser.close();
  }
}
