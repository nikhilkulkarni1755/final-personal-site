// Pure interpretation of Peerlist's HTTP response to a comments/add POST.
// No network, no browser -- kept separate from peerlistClient.ts so this
// classification logic can be unit-tested against real captured response
// bodies (R1-sources.md §1.7/§1.8) without ever making a request.
//
// D4's posting guard is structural here: every branch is a definite
// classification (posted / credential_expired / rejected) EXCEPT
// 'ambiguous', which is reserved for peerlistClient.ts to use when the POST
// itself failed at the network level and no response body exists to
// classify at all -- see that file for why that case must never retry.

import type { PeerlistCommentResponse, PostCommentResult } from './types.ts';

/** The exact message R1 observed for an invalid/expired `token` (§1.7). */
const EXPIRED_SESSION_MESSAGE = 'Invalid access, please login again.';

export function interpretCommentResponse(status: number, rawBody: string): PostCommentResult {
  let parsed: PeerlistCommentResponse;
  try {
    parsed = JSON.parse(rawBody) as PeerlistCommentResponse;
  } catch {
    // We got a response, so the server was reached and answered -- this is
    // not the "did we even send it" ambiguity the guard cares about. It is
    // an unrecognised shape, which we refuse to guess at.
    return {
      outcome: 'rejected',
      detail: `HTTP ${status} with a body that is not the JSON shape R1 documented: ${rawBody.slice(0, 300)}`,
    };
  }

  if (status === 200 && parsed.success === true) {
    return { outcome: 'posted', commentId: parsed.data.id, detail: `HTTP 200, comment id ${parsed.data.id}` };
  }

  if (parsed.success === false && parsed.error?.message === EXPIRED_SESSION_MESSAGE) {
    return {
      outcome: 'credential_expired',
      detail:
        `HTTP ${status}: "${EXPIRED_SESSION_MESSAGE}" -- Nikhil's Peerlist \`token\` cookie ` +
        'is invalid or expired (DECISIONS D3). Refresh the cookie jar; do not retry as-is.',
    };
  }

  return {
    outcome: 'rejected',
    detail: `HTTP ${status}: ${parsed.success === false ? parsed.error?.message : rawBody.slice(0, 300)}`,
  };
}
