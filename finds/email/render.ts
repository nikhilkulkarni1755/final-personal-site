import type { CriterionId, DigestInput, EmailCriterion, EmailFind } from './types.ts';

// Renders the daily digest as an HTML email (table layout, inline styles,
// dark-mode-safe colours, no external CSS, no flexbox/grid -- HTML email
// clients do not reliably support any of those) plus a text/plain
// alternative. Pure function: no I/O, no credentials, nothing here can send
// anything. See finds/email/dry-run.ts to render this to a file, and
// finds/email/transport.ts for the only place that touches SMTP.

const CRITERION_ORDER: CriterionId[] = ['C1', 'C2', 'C3', 'C4'];

// Light-mode colours, used as inline styles so every client has a sane
// default even if it strips <style> from <head>.
const BG = '#f4f4f5'; // page background
const CARD_BG = '#ffffff'; // content card background
const TEXT = '#18181b'; // primary text -- explicit, never relies on client default
const MUTED = '#52525b'; // secondary text
const BORDER = '#e4e4e7';
const YES = '#15803d';
const NO = '#b91c1c';
const LINK = '#1d4ed8';

// Dark-mode overrides for clients that honour prefers-color-scheme via a
// <style> block (Apple Mail, Outlook iOS/Android/Mac, most modern webmail).
// Paired with the classes below; the inline colours above stay as the
// fallback for clients that don't.
const DARK_STYLE = `
@media (prefers-color-scheme: dark) {
  .email-bg { background-color:#09090b !important; }
  .email-card { background-color:#18181b !important; }
  .email-text { color:#f4f4f5 !important; }
  .email-muted { color:#a1a1aa !important; }
  .email-border { border-color:#3f3f46 !important; }
  .email-link { color:#60a5fa !important; }
  .email-yes { color:#4ade80 !important; }
  .email-no { color:#f87171 !important; }
}`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links are ever emitted -- refuses to turn e.g. a
 * javascript: URL harvested from a crawl into a clickable link. */
function safeHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // fall through
  }
  return undefined;
}

function orderedCriteria(find: EmailFind): EmailCriterion[] {
  return [...find.criteria].sort(
    (a, b) => CRITERION_ORDER.indexOf(a.id) - CRITERION_ORDER.indexOf(b.id),
  );
}

function renderCriterionRowHtml(c: EmailCriterion): string {
  const mark = c.verdict ? '&#10003;' : '&#10007;';
  const color = c.verdict ? YES : NO;
  const markClass = c.verdict ? 'email-yes' : 'email-no';
  return `
    <tr>
      <td class="${markClass}" style="padding:4px 8px 4px 0;vertical-align:top;width:20px;color:${color};font-weight:700;font-family:Arial,Helvetica,sans-serif;font-size:14px;">${mark}</td>
      <td class="email-text" style="padding:4px 0;vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT};">
        <span style="font-weight:700;">${escapeHtml(c.label)}</span><br/>
        <span class="email-muted" style="color:${MUTED};">${escapeHtml(c.evidence)}</span>
      </td>
    </tr>`;
}

function renderFindHtml(find: EmailFind, index: number): string {
  const href = safeHref(find.url);
  const nameHtml = href
    ? `<a href="${escapeHtml(href)}" class="email-link" style="color:${LINK};text-decoration:none;">${escapeHtml(find.name)}</a>`
    : escapeHtml(find.name);
  return `
  <tr>
    <td style="padding:${index === 0 ? '0' : '24px'} 0 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-border" style="border:1px solid ${BORDER};border-radius:8px;">
        <tr>
          <td style="padding:16px;">
            <div class="email-text" style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:${TEXT};">${nameHtml}</div>
            <div class="email-muted" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};padding:2px 0 12px 0;">${escapeHtml(find.tagline)}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${orderedCriteria(find).map(renderCriterionRowHtml).join('')}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function renderEmptyHtml(): string {
  return `
  <tr>
    <td class="email-muted" style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};">
      Nothing cleared the bar today -- no find satisfied all four criteria with real evidence. No picks below is the honest result, not a bug.
    </td>
  </tr>`;
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
}

export function renderDigest(input: DigestInput): RenderedDigest {
  const count = input.finds.length;
  const subject =
    count === 0
      ? `Interesting Finds -- ${input.date}: nothing cleared the bar`
      : `Interesting Finds -- ${input.date}: ${count} pick${count === 1 ? '' : 's'}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${escapeHtml(subject)}</title>
<style>${DARK_STYLE}</style>
</head>
<body class="email-bg" style="margin:0;padding:0;background-color:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="background-color:${BG};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="email-card" style="max-width:600px;width:100%;background-color:${CARD_BG};border-radius:8px;">
          <tr>
            <td style="padding:24px 20px 8px 20px;font-family:Arial,Helvetica,sans-serif;">
              <div class="email-text" style="font-size:20px;font-weight:700;color:${TEXT};">Interesting Finds</div>
              <div class="email-muted" style="font-size:13px;color:${MUTED};padding-top:2px;">${escapeHtml(input.date)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 20px 20px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${count === 0 ? renderEmptyHtml() : input.finds.map(renderFindHtml).join('')}
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-muted email-border" style="padding:16px 20px 24px 20px;border-top:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};">
              Found something useful here? Say so on Telegram -- that is what promotes a
              find to the public Interesting Finds page and feeds the comment-back loop.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = renderText(input, subject);
  return { subject, html, text };
}

function renderText(input: DigestInput, subject: string): string {
  const lines: string[] = [subject, ''];
  if (input.finds.length === 0) {
    lines.push(
      'Nothing cleared the bar today -- no find satisfied all four criteria with real evidence.',
    );
  } else {
    for (const find of input.finds) {
      lines.push(`${find.name} -- ${find.tagline}`);
      lines.push(find.url);
      for (const c of orderedCriteria(find)) {
        lines.push(`  [${c.verdict ? 'x' : ' '}] ${c.label}: ${c.evidence}`);
      }
      lines.push('');
    }
  }
  lines.push(
    '---',
    'Found something useful here? Say so on Telegram -- that promotes a find to the',
    'public Interesting Finds page and feeds the comment-back loop.',
  );
  return lines.join('\n');
}
