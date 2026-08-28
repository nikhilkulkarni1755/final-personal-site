// Pure payload construction. No network, no filesystem, no credential --
// this is the one place that decides what bytes represent Nikhil's comment,
// and per D4 ("it should take my string and post it as is. no cleanup etc.")
// that decision is: none. `input.comment` passes through untouched -- no
// .trim(), no .normalize(), no HTML wrapping, no markdown handling.
//
// Kept separate from peerlistClient.ts so dry-run.ts can show the exact
// outgoing payload without importing anything that can reach the network.

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
    comment: input.comment,
    replyTo: input.replyTo ?? null,
    type: 'Project',
  };
}
