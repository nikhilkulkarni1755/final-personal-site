// Comment-back transport types (Peerlist first; see finds-coord/DECISIONS.md
// D4 and research/R1-sources.md §1.8). Local to this lane -- candidates for
// finds/types.ts once another lane needs them (W3 owns that file; propose
// through the coordinator, do not write there directly).

/**
 * What a caller supplies to post one comment. There is no queue and no
 * schedule (D4): every field here must be given explicitly, every time.
 */
export interface PostCommentInput {
  /** The Peerlist project id ("PRJ..."), e.g. finds_candidate_sightings.external_id. */
  activityId: string;
  /**
   * Nikhil's exact string, byte for byte. Never trimmed, wrapped, escaped,
   * or otherwise transformed before it reaches the wire -- see payload.ts
   * and verifyFidelity.ts, which exist to prove that.
   */
  comment: string;
  /** Parent comment id ("CH..."), to reply instead of top-level. */
  replyTo?: string | null;
}

/** The exact JSON body Peerlist's own client sends to comments/add. */
export interface PeerlistCommentPayload {
  activityId: string;
  comment: string;
  replyTo: string | null;
  type: 'Project';
}

/** Peerlist's own error shape, observed live (R1 §1.7) for an invalid/expired session. */
export interface PeerlistErrorResponse {
  success: false;
  error: { message: string };
}

export interface PeerlistCommentSuccess {
  success: true;
  data: { id: string; [key: string]: unknown };
}

export type PeerlistCommentResponse = PeerlistCommentSuccess | PeerlistErrorResponse;

/**
 * Outcome of one post attempt. 'ambiguous' means exactly what D4's posting
 * guard requires: we could not confirm success or failure, so the caller
 * must stop and report rather than retry (a retry could double-post).
 */
export type PostCommentOutcome = 'posted' | 'credential_expired' | 'ambiguous' | 'rejected';

export interface PostCommentResult {
  outcome: PostCommentOutcome;
  /** Peerlist's own comment id, only present when outcome === 'posted'. */
  commentId?: string;
  /** Human-readable detail for logging -- never the credential itself. */
  detail: string;
}
