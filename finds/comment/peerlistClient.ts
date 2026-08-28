// The ONLY file in this lane that imports Playwright, reads the Peerlist
// credential, or reaches the network. Everything else (payload.ts,
// interpretResponse.ts, dry-run.ts) is reachable with zero side effects, so
// that "can this code post a comment" reduces to "does it import this file".
//
// Why Playwright and not fetch/axios/curl: peerlist.io sits behind a
// Cloudflare Managed Challenge that 403s plain HTTP clients regardless of
// UA (R1-sources.md §1.2, measured). A real Chromium context passes it.
// Pattern, verified live by R1: launch headless Chromium, navigate to the
// cheap same-origin /robots.txt first (solves the challenge without the
// SPA burning the ~12-call/burst budget on its own XHRs, §1.3), then issue
// the POST as an in-page same-origin fetch so the browser's own cookie jar
// and TLS/JS fingerprint carry it through.
//
// Auth: exactly the `token` cookie (§1.7) -- nothing else from the jar is
// ever read or sent (config.ts). Sending more of Nikhil's live session than
// this one endpoint needs would be a real risk with no offsetting benefit.
//
// This file forwards `payload` opaquely (JSON.stringify only) and never
// touches `payload.comment` itself. The HTML-escape-and-wrap that D13
// requires already happened upstream in payload.ts/htmlEncode.ts; by the
// time a payload reaches here it is exactly the bytes to send.
//
// CSRF: Peerlist's own client sends no CSRF header and R1 could not verify
// server-side enforcement without posting (§1.8, UNVERIFIED). A CSRF
// rejection is a real possible response here, not a bug -- it lands in
// interpretResponse.ts's `rejected` outcome like any other.
//
// AT-MOST-ONCE, non-negotiable: this function makes exactly one POST
// attempt. No loop, no retry, no re-issue on a timeout. If the POST
// request itself fails at the network level (thrown by page.evaluate/fetch
// before any HTTP response comes back), we cannot tell whether Peerlist
// received and processed it -- retrying could double-post under Nikhil's
// name, so that case is reported as 'ambiguous' and the caller must stop,
// not retry. A failure that happens BEFORE the POST is even attempted
// (browser won't launch, robots.txt won't load) is a distinct, clean
// failure -- nothing was sent -- and is thrown as a plain Error instead,
// so it is never confused with "maybe posted, maybe not".

import { chromium } from 'playwright';
import { readPeerlistToken } from './config.ts';
import { interpretCommentResponse } from './interpretResponse.ts';
import type { PeerlistCommentPayload, PostCommentResult } from './types.ts';

const ORIGIN = 'https://peerlist.io';
const COMMENT_ENDPOINT = `${ORIGIN}/api/v1/activities/comments/add`;

export async function postCommentToPeerlist(payload: PeerlistCommentPayload): Promise<PostCommentResult> {
  const token = readPeerlistToken();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: 'token', value: token, domain: 'peerlist.io', path: '/', secure: true, httpOnly: true },
    ]);
    const page = await context.newPage();

    // Cheap same-origin load that solves the CF challenge without the SPA
    // spending the API-call budget on its own background requests (§1.3).
    // A failure here means we never got far enough to attempt the POST.
    const preflight = await page.goto(`${ORIGIN}/robots.txt`);
    if (!preflight || !preflight.ok()) {
      throw new Error(
        `Preflight failed: GET ${ORIGIN}/robots.txt returned ${preflight?.status() ?? 'no response'}. ` +
          'Nothing was posted -- the comment POST was never attempted.',
      );
    }

    // The actual POST. Anything thrown out of this evaluate() happened
    // while the request was in flight or its response was being read --
    // exactly the "can't tell if it landed" case the posting guard exists
    // for, so it is caught below and reported as 'ambiguous', not thrown.
    let status: number;
    let body: string;
    try {
      const result = await page.evaluate(
        async ({ url, payload }) => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
            body: JSON.stringify(payload),
          });
          return { status: res.status, body: await res.text() };
        },
        { url: COMMENT_ENDPOINT, payload },
      );
      status = result.status;
      body = result.body;
    } catch (err) {
      return {
        outcome: 'ambiguous',
        detail:
          `The POST to ${COMMENT_ENDPOINT} failed at the network level before a response was ` +
          `observed (${(err as Error).message}). Whether Peerlist received and processed it is ` +
          'unknown. Per the posting guard: report this and STOP -- do not retry, a retry could ' +
          'double-post.',
      };
    }

    return interpretCommentResponse(status, body);
  } finally {
    await browser.close();
  }
}
