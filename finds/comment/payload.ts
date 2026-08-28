// Pure payload construction. No network, no filesystem, no credential --
// this is the one place that decides what bytes represent Nikhil's comment.
//
// Per D4 ("it should take my string and post it as is. no cleanup etc.")
// there is no rewriting, reordering, trimming, padding, or case-changing of
// his content, ever. The one thing this function does apply is
// htmlEncode.ts's escape-and-wrap, per DECISIONS D13: Peerlist's comment
// field is HTML, so sending his string unescaped would corrupt what a
// reader actually sees (newlines vanish, a `<` is swallowed as markup).
// D13 draws the line exactly there -- that is transport encoding for the
// target format, not "cleanup" of his words. This file itself performs no
// string mutation; it delegates the one exception to htmlEncode.ts, which
// verifyFidelity.ts holds to that single job.
//
// Kept separate from peerlistClient.ts so dry-run.ts can show the exact
// outgoing payload without importing anything that can reach the network.

import { encodeCommentAsHtml } from './htmlEncode.ts';
import type { PeerlistCommentPayload, PostCommentInput } from './types.ts';

export function buildCommentPayload(input: PostCommentInput): PeerlistCommentPayload {
  if (!input.activityId) {
    throw new Error('buildCommentPayload: activityId is required.');
  }
  if (typeof input.comment !== 'string' || input.comment.length === 0) {
    throw new Error('buildCommentPayload: comment must be a non-empty string.');
  }
  return {
    activityId: input.activityId,
    comment: encodeCommentAsHtml(input.comment),
    replyTo: input.replyTo ?? null,
    type: 'Project',
  };
}
