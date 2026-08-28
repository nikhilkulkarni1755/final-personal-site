// HTML-encodes Nikhil's comment for Peerlist's rich-text comment field.
//
// DECISIONS D13 (coordinator, resolving the collision R1 flagged): Peerlist
// comments are HTML -- R1's own captured example reads
// `"comment": "<p>This seems really cool </p>"`. Literal byte-for-byte
// transmission of plain text into an HTML field CORRUPTS Nikhil's words:
// his line breaks collapse to nothing, and any `<` he types is swallowed as
// the start of a tag. That defeats D4's actual point, which is that what he
// writes is what a reader sees -- so fidelity has to be judged on the
// RENDERED result, not the raw wire bytes. Escaping is transport encoding,
// not editing: no character of his content is rewritten, reworded,
// trimmed, padded, or case-changed. See finds/comment/verifyFidelity.ts for
// the proof.
//
// This is the ONLY place in the lane that touches the comment text with a
// string method, and it does exactly two well-defined things:
//   1. escape the five HTML-significant characters, so `<`, `>`, `&`, and
//      quotes reach the reader as themselves instead of as markup;
//   2. turn each of his line breaks into a <br>, and wrap the whole thing
//      in a single <p>...</p> to match the structure Peerlist's own client
//      sends (R1-sources.md §1.8).
// Nothing here calls .normalize() -- no NFC/NFKC folding happens.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function encodeCommentAsHtml(raw: string): string {
  const escaped = escapeHtml(raw);
  const withLineBreaks = escaped.replace(/\r\n|\r|\n/g, '<br>');
  return `<p>${withLineBreaks}</p>`;
}
