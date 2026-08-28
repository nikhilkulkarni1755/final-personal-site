/**
 * Per-route metadata for every real route on the site: title, description,
 * canonical URL, Open Graph / Twitter fields, and JSON-LD structured data.
 *
 * /spearfishing/voice-agent is excluded (coordinator decision D4): it renders
 * Supabase-backed content with a hardcoded MOCK_DRUGS fallback when the table
 * is empty, and this site ships no stub data as fact.
 *
 * /blog/:slug (the generic catch-all) has no entry: React Router sends every
 * known slug to a dedicated static route above it in src/App.tsx, so the
 * catch-all never actually renders one of the three real posts (see R2 A5).
 *
 * This file owns metadata CONTENT only. The prerender snapshot script (a
 * separate lane's work) owns reading this map and injecting it into the
 * static HTML per route — no build-pipeline code lives here.
 *
 * Every JSON-LD block was validated structurally and against the live
 * schema.org vocabulary (types + property domains, including subclass
 * inheritance) before this file was committed.
 *
 * Every count and enumeration below (project list, blog list, weave
 * engineer/window numbers, social links) is computed from src/data/*.json
 * at module load, not hand-typed — so it cannot silently drift from the
 * source data the way a prose-authored count can.
 */

import projectsData from './projects.json' with { type: 'json' };
import blogsData from './blogs.json' with { type: 'json' };
import appsData from './apps.json' with { type: 'json' };
import socialData from './social.json' with { type: 'json' };
import weaveData from './weave-data.json' with { type: 'json' };

export const SITE_URL = 'https://nikhilkulkarni1755.com';
export const SITE_NAME = 'Nikhil Kulkarni';
/** The only real, on-site image usable as a default social-share card today. */
const DEFAULT_OG_IMAGE = `${SITE_URL}/videos/iridium-feature-demo.jpg`;
const PERSON_ID = `${SITE_URL}/#person`;
const personRef = { '@id': PERSON_ID };

interface ProjectRecord {
  id: number;
  title: string;
  description: string;
  techStack: string[];
  liveUrl?: string;
  github?: string;
}
const projects = projectsData as ProjectRecord[];

interface BlogRecord {
  id: number;
  title: string;
  slug: string;
  subtitle: string;
  publishDate: string;
  readTime: number;
  tags: string[];
}
const blogs = blogsData as BlogRecord[];
function findBlog(slug: string): BlogRecord {
  const post = blogs.find((b) => b.slug === slug);
  if (!post) throw new Error(`routeMeta: no blogs.json record for slug "${slug}"`);
  return post;
}

interface AppRecord {
  id: number;
  title: string;
  description: string;
  techStack: string[];
  appStoreLink: string;
}
const apps = appsData as AppRecord[];
const progressApp = apps[0];

interface SocialRecord {
  name: string;
  url: string;
  icon: string;
}
const social = socialData as SocialRecord[];
/** sameAs wants identity/profile pages, not a mailto: link — that goes on Person.email instead. */
const socialProfileUrls = social.filter((s) => !s.url.startsWith('mailto:')).map((s) => s.url);
const socialEmail = social.find((s) => s.url.startsWith('mailto:'))?.url ?? '';

interface WeaveData {
  generated_at: string;
  window_days: number;
  repo: string;
  engineers: Record<string, unknown>;
}
const weave = weaveData as unknown as WeaveData;
const weaveEngineerCount = Object.keys(weave.engineers).length;
const weaveGeneratedDate = weave.generated_at.slice(0, 10);

export interface OpenGraph {
  title: string;
  description: string;
  url: string;
  type: 'website' | 'article' | 'profile';
  image: string;
}

export interface TwitterCard {
  card: 'summary' | 'summary_large_image';
  title: string;
  description: string;
  image: string;
}

/** A JSON-LD document: one @context plus one or more schema.org nodes. */
export interface JsonLd {
  '@context': 'https://schema.org';
  '@graph': Record<string, unknown>[];
}

export interface RouteMeta {
  title: string;
  description: string;
  canonical: string;
  /**
   * Absolute URL of this route's markdown twin — the W2 path contract is
   * `/<route>.md`, with `/index.md` for the homepage. Same shape as
   * `canonical` and computed the same way, in the same function, precisely
   * so a prerendered snapshot can never inherit another route's alternate
   * (that class of bug already happened once with canonical — see C1).
   * There is no entry for /spearfishing/voice-agent in this map at all
   * (D4), so it never gets this field and W1's injector must emit no
   * <link rel="alternate"> tag for it, the same as it already does for
   * canonical. Optional (not just always-present-but-empty) because a route
   * can exist here before its markdown mirror does — see /interesting-finds,
   * where W2's twin hasn't landed yet; do not fabricate the path, omit it.
   */
  markdownAlternate?: string;
  og: OpenGraph;
  twitter: TwitterCard;
  jsonLd: JsonLd;
}

function graph(...nodes: Record<string, unknown>[]): JsonLd {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

function breadcrumb(segments: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: segments.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.name,
      item: `${SITE_URL}${s.path}`,
    })),
  };
}

function meta(path: string, opts: {
  title: string;
  description: string;
  type?: OpenGraph['type'];
  image?: string;
  /** False only for a route whose markdown mirror doesn't exist yet (W2 lands it in parallel). */
  hasMarkdownMirror?: boolean;
}): Pick<RouteMeta, 'title' | 'description' | 'canonical' | 'markdownAlternate' | 'og' | 'twitter'> {
  const canonical = `${SITE_URL}${path}`;
  // W2's path contract: homepage -> /index.md, everything else -> <path>.md.
  const markdownAlternate = `${SITE_URL}${path === '/' ? '/index.md' : `${path}.md`}`;
  const image = opts.image ?? DEFAULT_OG_IMAGE;
  return {
    title: opts.title,
    description: opts.description,
    canonical,
    ...((opts.hasMarkdownMirror ?? true) ? { markdownAlternate } : {}),
    og: {
      title: opts.title,
      description: opts.description,
      url: canonical,
      type: opts.type ?? 'website',
      image,
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
      image,
    },
  };
}

// ─── Shared nodes ────────────────────────────────────────────────────────

/** Real experience/education/certifications from src/pages/About.tsx. */
const person = {
  '@type': 'Person',
  '@id': PERSON_ID,
  name: 'Nikhil Kulkarni',
  url: SITE_URL,
  email: socialEmail,
  jobTitle: 'Software Engineer',
  description:
    'Creator of Iridium — LinkedIn for AI Agents (iridiumhqmcp.com), merged PRs @ vLLM and SGLang, AWS DevOps Professional Certified, 2 YOE @ Google via Tata Consultancy Services.',
  alumniOf: { '@type': 'CollegeOrUniversity', name: 'Rutgers University' },
  knowsAbout: [
    'AI Agents',
    'Model Context Protocol (MCP)',
    'LLM Inference',
    'vLLM',
    'SGLang',
    'Agent Orchestration',
    'Cloud Infrastructure',
  ],
  // Real social profiles from src/data/social.json (mailto: excluded, see socialEmail
  // above) — earns json-ld entity linking.
  sameAs: socialProfileUrls,
  // Defensible, unembellished "open to work" signal — no invented start date.
  seeks: {
    '@type': 'Demand',
    name: 'Full-time Software Engineer / AI Engineer roles',
    description: 'Agent infrastructure, MCP tooling, and LLM inference and serving.',
  },
} as const;

const website = {
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description:
    'Portfolio and technical writing from Nikhil Kulkarni: AI agents, MCP tooling, and LLM inference infrastructure.',
};

// ─── Route map ───────────────────────────────────────────────────────────

export const routeMeta: Record<string, RouteMeta> = {
  '/': {
    ...meta('/', {
      title: 'Nikhil Kulkarni — Software Engineer, AI Agents in Production',
      description:
        'Creator of Iridium — LinkedIn for AI Agents (iridiumhqmcp.com), merged PRs @ vLLM and SGLang, AWS DevOps Professional Certified, 2 YOE @ Google via Tata Consultancy Services.',
      type: 'profile',
    }),
    jsonLd: graph(website, person),
  },

  '/projects': {
    ...meta('/projects', {
      title: 'Projects — Nikhil Kulkarni',
      description:
        `${projects.length} shipped projects: Iridium (an MCP server for live LinkedIn agent access), a vLLM inference deployment on EKS, a multi-tenant Kubernetes platform, and more — with source, demos, and tech stack for each.`,
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Projects', path: '/projects' }]),
      {
        '@type': 'ItemList',
        name: 'Nikhil Kulkarni — Projects',
        numberOfItems: projects.length,
        // Generated directly from projects.json, in its own array order (the same
        // order src/pages/Projects.tsx renders) — see the coordinator note in
        // agent-ready-coord/lanes/W3.md about why this used to be hand-typed and
        // silently dropped a project.
        itemListElement: projects.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: p.liveUrl
            ? {
                '@type': 'SoftwareApplication',
                name: p.title,
                description: p.description,
                url: p.liveUrl,
                applicationCategory: 'DeveloperApplication',
                keywords: p.techStack.join(', '),
                author: personRef,
              }
            : {
                '@type': 'SoftwareSourceCode',
                name: p.title,
                description: p.description,
                codeRepository: p.github,
                keywords: p.techStack.join(', '),
                author: personRef,
              },
        })),
      },
    ),
  },

  '/blog': {
    ...meta('/blog', {
      title: 'Blog — Nikhil Kulkarni',
      description:
        'Long-form writing on AI agents, LLM internals, and infrastructure: a cold-outreach agent, the math behind transformers, and keeping secrets out of coding agents.',
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }]),
      {
        '@type': 'Blog',
        '@id': `${SITE_URL}/blog#blog`,
        name: 'Nikhil Kulkarni — Blog',
        url: `${SITE_URL}/blog`,
        author: personRef,
        // Generated from blogs.json, same array order src/pages/Blog.tsx renders.
        blogPost: blogs.map((b) => ({
          '@type': 'BlogPosting',
          headline: b.title,
          url: `${SITE_URL}/blog/${b.slug}`,
        })),
      },
    ),
  },

  '/blog/matmul-to-ai': (() => {
    const post = findBlog('matmul-to-ai');
    const path = `/blog/${post.slug}`;
    return {
      ...meta(path, {
        title: `${post.title} — Nikhil Kulkarni`,
        description: post.subtitle,
        type: 'article',
      }),
      jsonLd: graph(
        breadcrumb([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }, { name: post.title, path }]),
        {
          '@type': 'BlogPosting',
          '@id': `${SITE_URL}${path}#post`,
          headline: post.title,
          description: post.subtitle,
          url: `${SITE_URL}${path}`,
          mainEntityOfPage: `${SITE_URL}${path}`,
          datePublished: post.publishDate,
          timeRequired: `PT${post.readTime}M`,
          keywords: post.tags,
          author: personRef,
          isPartOf: { '@id': `${SITE_URL}/blog#blog` },
          inLanguage: 'en-US',
        },
      ),
    };
  })(),

  '/blog/linkedin-agent': (() => {
    const post = findBlog('linkedin-agent');
    const path = `/blog/${post.slug}`;
    return {
      ...meta(path, {
        title: `${post.title} — Nikhil Kulkarni`,
        description: post.subtitle,
        type: 'article',
      }),
      jsonLd: graph(
        breadcrumb([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }, { name: post.title, path }]),
        {
          '@type': 'BlogPosting',
          '@id': `${SITE_URL}${path}#post`,
          headline: post.title,
          description: post.subtitle,
          url: `${SITE_URL}${path}`,
          mainEntityOfPage: `${SITE_URL}${path}`,
          datePublished: post.publishDate,
          timeRequired: `PT${post.readTime}M`,
          keywords: post.tags,
          author: personRef,
          isPartOf: { '@id': `${SITE_URL}/blog#blog` },
          inLanguage: 'en-US',
        },
      ),
    };
  })(),

  '/blog/docker-secrets-injection': (() => {
    const post = findBlog('docker-secrets-injection');
    const path = `/blog/${post.slug}`;
    return {
      ...meta(path, {
        title: `${post.title} — Nikhil Kulkarni`,
        description: post.subtitle,
        type: 'article',
      }),
      jsonLd: graph(
        breadcrumb([{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }, { name: post.title, path }]),
        {
          '@type': 'BlogPosting',
          '@id': `${SITE_URL}${path}#post`,
          headline: post.title,
          description: post.subtitle,
          url: `${SITE_URL}${path}`,
          mainEntityOfPage: `${SITE_URL}${path}`,
          datePublished: post.publishDate,
          timeRequired: `PT${post.readTime}M`,
          keywords: post.tags,
          author: personRef,
          isPartOf: { '@id': `${SITE_URL}/blog#blog` },
          inLanguage: 'en-US',
        },
      ),
    };
  })(),

  '/apps': {
    ...meta('/apps', {
      title: 'Apps — Nikhil Kulkarni',
      description: `${progressApp.title}: an iOS and Android app that helps people build difficult habits with friends, built with ${progressApp.techStack.slice(0, 3).join(', ')}.`,
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Apps', path: '/apps' }]),
      {
        '@type': 'SoftwareApplication',
        name: progressApp.title,
        description: progressApp.description,
        url: progressApp.appStoreLink,
        operatingSystem: 'iOS, Android',
        applicationCategory: 'LifestyleApplication',
        keywords: progressApp.techStack.join(', '),
        author: personRef,
      },
    ),
  },

  '/about': {
    ...meta('/about', {
      title: 'About — Nikhil Kulkarni',
      description:
        'AI engineer with 2+ years at Google Search (via Tata Consultancy Services), a CS degree from Rutgers, and AWS DevOps Professional certification.',
      type: 'profile',
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'About', path: '/about' }]),
      {
        '@type': 'ProfilePage',
        '@id': `${SITE_URL}/about#profilepage`,
        url: `${SITE_URL}/about`,
        dateModified: '2026-08-28',
        mainEntity: {
          ...person,
          hasCredential: [
            'AWS DevOps Professional',
            'AWS Developer Associate',
            'AWS Cloud Practitioner',
            'Deeplearning.AI Finetuning Large Language Models',
            'MongoDB Building RAG Apps',
          ].map((name) => ({ '@type': 'EducationalOccupationalCredential', name })),
        },
      },
    ),
  },

  '/privacy-policy': {
    ...meta('/privacy-policy', {
      title: 'Privacy Policy — Nikhil Kulkarni',
      description: 'How nikhilkulkarni1755.com collects, uses, and protects visitor data.',
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Privacy Policy', path: '/privacy-policy' }]),
      {
        '@type': 'WebPage',
        name: 'Privacy Policy',
        url: `${SITE_URL}/privacy-policy`,
        description: 'How nikhilkulkarni1755.com collects, uses, and protects visitor data.',
        isPartOf: { '@id': `${SITE_URL}/#website` },
      },
    ),
  },

  '/spearfishing/fireworks-ai': {
    ...meta('/spearfishing/fireworks-ai', {
      title: 'A Purpose-Built Disaggregated Inference Engine — Nikhil Kulkarni',
      description:
        'Splitting prefill from decode across two H100s, measured against a colocated baseline on the same hardware — real captured benchmark data, not simulated numbers.',
      type: 'article',
    }),
    jsonLd: graph(
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Fireworks AI', path: '/spearfishing/fireworks-ai' },
      ]),
      {
        '@type': 'TechArticle',
        headline: 'A purpose-built disaggregated inference engine',
        description:
          'Splitting prefill from decode across two H100s, measured against a colocated baseline on the same hardware — real captured benchmark data, not simulated numbers.',
        url: `${SITE_URL}/spearfishing/fireworks-ai`,
        mainEntityOfPage: `${SITE_URL}/spearfishing/fireworks-ai`,
        keywords: ['LLM Inference', 'Disaggregated Serving', 'vLLM', 'GPU Scheduling', 'KV Cache'],
        author: personRef,
        inLanguage: 'en-US',
      },
    ),
  },

  '/take-homes/weave': {
    ...meta('/take-homes/weave', {
      title: 'PostHog Engineering Impact — Weave Take-Home — Nikhil Kulkarni',
      description:
        `A take-home analysis of ${weaveEngineerCount} engineers across ${weave.repo} over a ${weave.window_days}-day window: feature owners, reviewers, and infra specialists, ranked and explained.`,
      type: 'article',
    }),
    jsonLd: graph(
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Weave Take-Home', path: '/take-homes/weave' },
      ]),
      {
        '@type': 'Article',
        headline: 'PostHog Engineering Impact',
        description:
          `A take-home analysis of ${weaveEngineerCount} engineers across ${weave.repo} over a ${weave.window_days}-day window: feature owners, reviewers, and infra specialists, ranked and explained.`,
        url: `${SITE_URL}/take-homes/weave`,
        mainEntityOfPage: `${SITE_URL}/take-homes/weave`,
        datePublished: weaveGeneratedDate,
        keywords: ['Engineering Analytics', 'PostHog', 'Take-Home'],
        author: personRef,
        inLanguage: 'en-US',
      },
    ),
  },

  '/interesting-finds': {
    // Page-level metadata only. The page itself injects its own runtime
    // ItemList (src/pages/InterestingFinds.tsx, @id .../interesting-finds#list)
    // with numberOfItems/itemListElement reflecting what actually loaded — a
    // build-time count here would be fabricated, the exact thing this
    // initiative refuses to ship. Do not add an ItemList in this file. W1's
    // prerender pass strips any pre-existing JSON-LD before injecting this
    // block, so this CollectionPage node is what a crawler sees in the
    // static snapshot; the runtime ItemList only exists after client
    // hydration re-runs in a live browser. Markdown mirror (W2) has landed
    // at public/interesting-finds.md — default hasMarkdownMirror (true)
    // applies, same as every other route.
    ...meta('/interesting-finds', {
      title: 'Interesting Finds — Nikhil Kulkarni',
      description:
        'Product launches Nikhil Kulkarni found genuinely interesting: checked against four criteria — a verified claim, a rare problem solved, no gated access, and agent/MCP friendliness — before earning a spot.',
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Interesting Finds', path: '/interesting-finds' }]),
      {
        '@type': 'CollectionPage',
        '@id': `${SITE_URL}/interesting-finds#page`,
        name: 'Interesting Finds',
        description:
          'Product launches Nikhil Kulkarni found genuinely interesting: checked against four criteria — a verified claim, a rare problem solved, no gated access, and agent/MCP friendliness — before earning a spot.',
        url: `${SITE_URL}/interesting-finds`,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        author: personRef,
        inLanguage: 'en-US',
      },
    ),
  },

  '/bot': {
    // Fully static crawler disclosure (src/pages/Bot.tsx) — no Supabase data,
    // no stub fallback, so this gets full treatment with no caveats. A
    // WebPage node is the honest fit here: this page isn't an article, a
    // product listing, or a person profile, it's a disclosure document
    // describing a crawler. Do not invent a richer type than that.
    // Markdown mirror (W2) has landed at public/bot.md (confirmed against
    // their pushed tree post-fetch, blob f3f4f4b on
    // agent-ready/w2-llmstxt) — default hasMarkdownMirror (true) applies,
    // same as every other route.
    ...meta('/bot', {
      title: 'Interesting Finds Bot — Nikhil Kulkarni',
      description:
        'Public disclosure for InterestingFindsBot: who operates it, what it crawls and why, its exact User-Agent string, how to block it, and what it will never do.',
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Interesting Finds Bot', path: '/bot' }]),
      {
        '@type': 'WebPage',
        name: 'Interesting Finds Bot',
        description:
          'Public disclosure for InterestingFindsBot: who operates it, what it crawls and why, its exact User-Agent string, how to block it, and what it will never do.',
        url: `${SITE_URL}/bot`,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        author: personRef,
        inLanguage: 'en-US',
      },
    ),
  },
};

export default routeMeta;
