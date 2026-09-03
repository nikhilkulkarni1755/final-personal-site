# *Cold* Outreach Agent

[Back to Blog](/blog)

Engineering Case Study

Profile analysis, 6-stage LLM drafting, and reply handling — with me as the final quality gate.

Author: Nikhil Kulkarni

April 23, 2026

12 min read

Profile Analysis LLM Pipeline Claude Sonnet PostgreSQL FastAPI

[01 · Pipeline](#s1) [02 · Tech Stack](#s2) [03 · LLM Pipeline](#s3) [04 · Reply Handling](#s4) [05 · Scheduling](#s5) [06 · Problems](#s6) [07 · Results](#s7) [08 · What's Next](#s8)

Cold outreach doesn't work when it reads like cold outreach. Templates get ignored. Mass personalization tools produce messages that feel AI-generated because they are.

I needed a system that generates LinkedIn connection notes indistinguishable from ones I'd write by hand — but at 10x the throughput. Each message had to reference something specific the recipient actually did, match their communication style, and pass my own review before sending.

The alternative was 30-45 minutes per person researching, writing, and scheduling. At that rate, reaching 100 people takes a month. This system does the same quality in minutes per person, with me as the final quality gate.

Section 01

## Pipeline

Interactive · 9-Stage Pipeline

▶ Animate

01 · Search

Keyword query → headline-tier scoring

02 · Enrich

Full profile → re-score with complete data

03 · Generate

6-stage LLM pipeline, best-of-N

04 · Review

Interactive CLI · approve / edit / rewrite

05 · Schedule

Activity-pattern timing in local TZ

06 · Send

Connection invites via LinkedIn API

07 · Reply Handling

Webhook → LLM draft → approval → DM

Click Animate to walk through the nine pipeline stages.

**Input:** A search query (e.g., "Engineering Manager agentic AI") and a target location. **Output:** Personalized LinkedIn connection notes, reviewed and scheduled, with reply handling via an approval workflow.

system topology

```
LinkedIn API → Search → Enrich → Generate → Review → Schedule → Send
                                 ↓                              ↓
                                 Claude/GPT-4                   LinkedIn API
                                 (6-stage pipeline)             (connection invites)

LinkedIn Webhook
    ↓
Background Worker
(reply drafting, approval polling, DM sending)
```

Seven stages:

1. **Search** — Find profiles via keyword queries. Score on headline keywords using a three-tier weighted system.
2. **Enrich** — Fetch full profiles: work history, about, posts, comments, skills. Re-score with complete data.
3. **Generate** — Six-stage LLM pipeline produces a personalized connection note. Three attempts, best-of-N selection.
4. **Review** — Interactive CLI. Full profile context alongside the draft. Approve, edit, or trigger a rewrite. Nothing sends without my approval.
5. **Schedule** — Send time based on when the recipient is active on LinkedIn (inferred from post/comment timestamps, converted to their local timezone). Sends spread across weekdays with daily caps.
6. **Send** — Connection invites fire via LinkedIn API with gaps between sends to stay within platform limits.
7. **Reply Handling** — When someone replies, a webhook captures the message, the system drafts a response via LLM, and notifies me. I approve, edit, or request a rewrite with a single command.

Section 02

## Tech Stack

| Layer | Technology |
| --- | --- |
| LLM | Anthropic Claude Sonnet (primary), OpenAI GPT-4o (fallback) |
| LinkedIn | Third-party API for search, profiles, posts, connection invites, DMs, webhooks |
| Scheduling | Background worker with SQLite queue, polls every 60s |
| Reply handling | Webhook → worker → LLM draft → notification → approval poll → DM API |
| Database | PostgreSQL with SQLAlchemy ORM, JSONB for raw profiles |
| Language | Python. No framework. stdlib where possible. |

Section 03

## The LLM Pipeline

This is where most of the complexity lives. Each connection note goes through six stages. If quality checks fail, the pipeline retries up to three times with feedback from previous failures.

Stage 1

Profile Intel

Stage 2

Angle Score

Stage 3

Style Examples

Stage 4

Constrained Gen

Stage 5

LLM Detection

Stage 6

Time Check

✓ Send

or retry → S4

**Stage 1 — Profile Intelligence Extraction.** LLM reads the full profile and outputs structured JSON: what they're working on, their career trajectory, overlaps with my background, their communication style, and one "resonance anchor" — a concrete detail about their work that becomes the highlight of the message.

**Stage 2 — Angle Generation and Scoring.** LLM generates 4-5 outreach angles, each scored on specificity (would this apply to 100 other people?), relevance (is there a natural reason to reach out?), and warmth (would this make them respond?). Highest-scoring angle wins.

**Stage 3 — Style Example Retrieval.** The pipeline picks 2-3 reference messages from a curated set I've written. Selected by angle similarity to give the generator concrete examples of my voice.

**Stage 4 — Constrained Generation.** Structural template enforces a 2-sentence format for the 300-character LinkedIn limit: what I built plus one specific thing about them, then the ask. No greeting (LinkedIn frames it), no sign-off (your name shows automatically), no links, no emojis. A banned-phrases list blocks 27+ anti-patterns including "I'd love to connect", "swap notes", "resonated with me", "impressive", "caught my eye."

**Stage 5 — LLM Detection Check.** A separate LLM call scores the draft 1-10 on how AI-generated it reads. Checks for formulaic structure, AI tells, unnaturally smooth transitions. Threshold: score < 7 to pass.

**Stage 6 — Respect-Their-Time Check.** The LLM role-plays as the recipient and evaluates: Would you read this? Is the ask clear? Did the sender earn the right to ask? Messages with filler or unclear asks fail.

◆ Insight — **Retry logic:** If either check fails, the specific failure feeds back into Stage 4 as additional constraints. Up to 3 attempts. If none pass cleanly, the system picks the best-scoring attempt.

Section 04

## Reply Handling

When someone replies, the system drafts a contextual response, gets my approval, and sends it — without me opening LinkedIn.

A webhook fires when any LinkedIn message arrives. The handler:

1. **Filters** — Checks the sender against tracked contacts. Messages from strangers are ignored.
2. **Deduplicates** — Checks message ID to avoid processing twice.
3. **Fetches conversation** — Pulls the full thread, not just the latest message.
4. **Drafts a reply** — Claude Sonnet gets the conversation thread, contact name, and company. System prompt: acknowledge what they said, steer toward a 15-minute call, stay under 500 characters, sound like a real person.
5. **Notifies me** with the conversation, drafted reply, and three commands:

Interactive · Reply Approval Flow

▶ Animate

LinkedIn reply

recipient replies on connection

↓

Webhook receiver

incoming message · filter + dedupe

↓

LLM draft v—

Claude Sonnet · ≤ 500 chars

↓

Gmail notification

thread + draft + commands

My email reply (a / e / w)

a

approve

e

edit

w

rewrite

w is recursive — keeps cycling LLM Draft → Notification until I send a or e.

↺ rewrite loop

LinkedIn DM send

send approved reply

↓

message sent

confirmation email back to me

Click Animate to watch a LinkedIn reply land, get drafted, and approved over email.

notification

```
[Name] @ [Company] replied on LinkedIn.

CONVERSATION:
[full thread with timestamps]

DRAFTED REPLY:
[LLM-generated response]

---
  a — send drafted reply as-is
  e, [your text] — send your version instead
  w, [feedback] — rewrite with AI and notify again
```

- **`a`** — Send the draft as-is.
- **`e, [text]`** — Send my exact text instead.
- **`w, [feedback]`** — Rewrite with my feedback (e.g., "make it shorter", "angle should be about their k8s work"). Notifies me again for another round.

`w` is recursive — I can keep refining. The system only sends a DM on `a` or `e`. I manage LinkedIn conversations entirely from my phone.

Section 05

## Activity-Pattern Scheduling

Every person's LinkedIn posts and comments have timestamps. The pipeline converts these to the recipient's local timezone and builds a histogram of activity by hour.

If >= 30% of activity falls between 5-10 PM local, they're scheduled for evening. Everyone else defaults to 9:30 AM local with jitter. Sends are restricted to weekdays. Requires a minimum of 5 data points before trusting the evening signal; below that, defaults to morning.

Section 06

## Problems Encountered

⚡ Lesson — **LLM detection scores consistently at 8/10.** Cold outreach is structurally formulaic (compliment → credential → ask) regardless of who wrote it. The detection stage was calibrated against long-form writing, not short messages. Mitigated with best-of-N selection: three attempts give enough variance that the cleanest version surfaces.

⚡ Lesson — **API hangs on dense profiles.** Some profiles with extensive work histories caused the API to stall for 60+ seconds. Added explicit timeouts so failures surface cleanly instead of blocking the batch.

⚡ Lesson — **Tone calibration across seniority levels.** Early drafts used peer-level language with VP/Director-level recipients. The prompt now detects recipient persona (builder, enterprise leader, IC, researcher) and adjusts — reaching up to senior leaders should sound curious and humble, not like cosplaying as equals.

⚡ Lesson — **Bolding the wrong thing.** Initial messages bolded the sender's credentials. Reversed the rule: the highlight must be about the recipient's work — something they'll recognize and care about.

⚡ Lesson — **SQLite concurrent access.** The background scheduler held a database connection while HTTP endpoints tried to write. Fixed by adding timeouts to all connections so writers wait for the lock instead of failing.

⚡ Lesson — **Prompt iteration from verbose to minimal.** Three rounds: (1) Mode A/B with technical depth vs. trajectory approaches — too formulaic. (2) Five-angle analysis — still too abstract. (3) Final 2-sentence format with hard structural rules. This is what ships.

Section 07

## Results

- 100+ new connections in 2 months
- ~25 profiles per run (discovery through drafting)
- Average 3 LLM calls per message (generation + 2 quality checks), up to 9 on retries
- ~15 minutes for enrichment + generation, ~10 minutes for review per batch
- Webhook-to-notification latency under 30 seconds

Section 08

## What's Next

- **Autonomous agent loop.** LLM agent wrapping the CLI to run discover → enrich → draft → schedule on a daily cron with city/state rotation.
- **A/B testing on send times.** The activity-pattern heuristic is untested against random timing.
- **Automated follow-up DMs** after connection acceptance.
- **Polling fallback for webhooks.** Periodic poll of recent conversations to catch missed replies.

viewing now

Views

Likes

Comments

[Back to Blog](/blog)
