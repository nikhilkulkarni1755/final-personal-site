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
 */

export const SITE_URL = 'https://nikhilkulkarni1755.com';
export const SITE_NAME = 'Nikhil Kulkarni';
/** The only real, on-site image usable as a default social-share card today. */
const DEFAULT_OG_IMAGE = `${SITE_URL}/videos/iridium-feature-demo.jpg`;
const PERSON_ID = `${SITE_URL}/#person`;
const personRef = { '@id': PERSON_ID };

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
}): Pick<RouteMeta, 'title' | 'description' | 'canonical' | 'og' | 'twitter'> {
  const canonical = `${SITE_URL}${path}`;
  const image = opts.image ?? DEFAULT_OG_IMAGE;
  return {
    title: opts.title,
    description: opts.description,
    canonical,
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
  email: 'mailto:nikhilkulkarni1755@gmail.com',
  jobTitle: 'Software Engineer',
  description:
    'Software engineer building AI agents in production. Creator of Iridium, an MCP server giving AI agents real access to LinkedIn. Contributor to vLLM and SGLang.',
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
  // Real social profiles from src/data/social.json — earns json-ld entity linking.
  sameAs: [
    'https://github.com/nikhilkulkarni1755',
    'https://linkedin.com/in/nikhilkulkarni1755',
    'https://x.com/nsk1755',
  ],
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
        'Software engineer building AI agents in production. Creator of Iridium, an MCP server giving agents real access to LinkedIn. Contributor to vLLM and SGLang.',
      type: 'profile',
    }),
    jsonLd: graph(website, person),
  },

  '/projects': {
    ...meta('/projects', {
      title: 'Projects — Nikhil Kulkarni',
      description:
        'Seven shipped projects: Iridium (an MCP server for live LinkedIn agent access), a vLLM inference deployment on EKS, a multi-tenant Kubernetes platform, and more — with source, demos, and tech stack for each.',
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Projects', path: '/projects' }]),
      {
        '@type': 'ItemList',
        name: 'Nikhil Kulkarni — Projects',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            item: {
              '@type': 'SoftwareApplication',
              name: 'Iridium',
              description:
                'Agent-native LinkedIn access. An MCP server giving any agent live profile and post data plus real actions — comments, DMs, connection requests, scheduled posts. 50+ tools across prospecting, inbox triage, commenting, and content, with user approval required before anything sends, server-side rate limits, and a full activity log.',
              url: 'https://iridiumhqmcp.com',
              applicationCategory: 'DeveloperApplication',
              keywords: 'MCP, Agent Orchestration, Human-in-the-Loop, Tool-Calling Design, OAuth, Multi-Tenant, FastAPI, PostgreSQL, Evals',
              author: personRef,
            },
          },
          {
            '@type': 'ListItem',
            position: 2,
            item: {
              '@type': 'SoftwareSourceCode',
              name: 'Iridium Agent',
              description:
                'Open-source chat agent that drives Iridium over MCP. Two states driven by the live connection: unauthenticated it can only describe the toolset and hand back a signup link, never pretending to act; once the server reports ready, every live tool flows in automatically.',
              codeRepository: 'https://github.com/nikhilkulkarni1755/iridium-agent',
              programmingLanguage: 'TypeScript',
              keywords: 'Cloudflare Agents, MCP Client, Durable Objects, Workers AI, OAuth, TypeScript',
              author: personRef,
            },
          },
          {
            '@type': 'ListItem',
            position: 3,
            item: {
              '@type': 'SoftwareSourceCode',
              name: 'vLLM on EKS',
              description:
                'Fully observable, multi-tenant, scalable inference deployment of vLLM on EKS. Per-tenant isolation with GPU scheduling and metrics wired end to end.',
              codeRepository: 'https://github.com/nikhilkulkarni1755/vllm-eks-deployment',
              keywords: 'vLLM, LLM Inference, EKS, Multi-Tenant, Observability, Terraform',
              author: personRef,
            },
          },
          {
            '@type': 'ListItem',
            position: 4,
            item: {
              '@type': 'SoftwareSourceCode',
              name: 'Linkedin Agent',
              description: 'Agent which finds possible connections and sends them cold connection requests.',
              codeRepository: 'https://github.com/nikhilkulkarni1755/linkedin-agent',
              keywords: 'LangGraph, LangChain, Linkedin API, LMStudio',
              author: personRef,
            },
          },
          {
            '@type': 'ListItem',
            position: 5,
            item: {
              '@type': 'SoftwareSourceCode',
              name: 'Skim Research Papers Agent',
              description: 'RAG agent which helps summarize 100+ page research papers. Built with AWS CI/CD in mind.',
              codeRepository: 'https://github.com/MacAndPC/chat-app',
              keywords: 'Pinecone, AWS Lambda, AWS S3, Qwen LLM',
              author: personRef,
            },
          },
          {
            '@type': 'ListItem',
            position: 6,
            item: {
              '@type': 'SoftwareSourceCode',
              name: 'Multi Tenant Kubernetes',
              description:
                'Kubernetes hosting system which allows each user a private secure namespace, serving a common product while keeping private data namespaced.',
              codeRepository: 'https://github.com/nikhilkulkarni1755/multi-tenant-k8',
              keywords: 'Kubernetes, Docker, Prometheus, Grafana, Terraform, AWS',
              author: personRef,
            },
          },
          {
            '@type': 'ListItem',
            position: 7,
            item: {
              '@type': 'SoftwareSourceCode',
              name: 'Terminal Tweet',
              description: 'Tweet from the terminal — create a server or just tweet with the CLI.',
              codeRepository: 'https://github.com/nikhilkulkarni1755/twitter-oauth2',
              keywords: 'Uvicorn, OAuth 2.0 (PKCE), X API',
              author: personRef,
            },
          },
        ],
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
        blogPost: [
          { '@type': 'BlogPosting', headline: 'From Matrices to Minds', url: `${SITE_URL}/blog/matmul-to-ai` },
          { '@type': 'BlogPosting', headline: 'Cold Outreach Agent', url: `${SITE_URL}/blog/linkedin-agent` },
          {
            '@type': 'BlogPosting',
            headline: 'Your Agentic Coding Tool is Reading Your Secrets',
            url: `${SITE_URL}/blog/docker-secrets-injection`,
          },
        ],
      },
    ),
  },

  '/blog/matmul-to-ai': {
    ...meta('/blog/matmul-to-ai', {
      title: 'From Matrices to Minds — Nikhil Kulkarni',
      description:
        'How a grid of numbers — multiplied together billions of times — became the engine of modern intelligence.',
      type: 'article',
    }),
    jsonLd: graph(
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Blog', path: '/blog' },
        { name: 'From Matrices to Minds', path: '/blog/matmul-to-ai' },
      ]),
      {
        '@type': 'BlogPosting',
        '@id': `${SITE_URL}/blog/matmul-to-ai#post`,
        headline: 'From Matrices to Minds',
        description:
          'How a grid of numbers — multiplied together billions of times — became the engine of modern intelligence.',
        url: `${SITE_URL}/blog/matmul-to-ai`,
        mainEntityOfPage: `${SITE_URL}/blog/matmul-to-ai`,
        datePublished: '2026-03-05',
        timeRequired: 'PT25M',
        keywords: ['Linear Algebra', 'Neural Networks', 'Transformers', 'GPUs'],
        author: personRef,
        isPartOf: { '@id': `${SITE_URL}/blog#blog` },
        inLanguage: 'en-US',
      },
    ),
  },

  '/blog/linkedin-agent': {
    ...meta('/blog/linkedin-agent', {
      title: 'Cold Outreach Agent — Nikhil Kulkarni',
      description:
        'Profile analysis, 6-stage LLM drafting, and reply handling — with me as the final quality gate.',
      type: 'article',
    }),
    jsonLd: graph(
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Blog', path: '/blog' },
        { name: 'Cold Outreach Agent', path: '/blog/linkedin-agent' },
      ]),
      {
        '@type': 'BlogPosting',
        '@id': `${SITE_URL}/blog/linkedin-agent#post`,
        headline: 'Cold Outreach Agent',
        description: 'Profile analysis, 6-stage LLM drafting, and reply handling — with me as the final quality gate.',
        url: `${SITE_URL}/blog/linkedin-agent`,
        mainEntityOfPage: `${SITE_URL}/blog/linkedin-agent`,
        datePublished: '2026-04-23',
        timeRequired: 'PT12M',
        keywords: ['Profile Analysis', 'LLM Pipeline', 'Claude Sonnet', 'PostgreSQL', 'FastAPI'],
        author: personRef,
        isPartOf: { '@id': `${SITE_URL}/blog#blog` },
        inLanguage: 'en-US',
      },
    ),
  },

  '/blog/docker-secrets-injection': {
    ...meta('/blog/docker-secrets-injection', {
      title: 'Your Agentic Coding Tool is Reading Your Secrets — Nikhil Kulkarni',
      description: 'Why your coding agent should never see your secrets — and how Docker makes that possible.',
      type: 'article',
    }),
    jsonLd: graph(
      breadcrumb([
        { name: 'Home', path: '/' },
        { name: 'Blog', path: '/blog' },
        { name: 'Your Agentic Coding Tool is Reading Your Secrets', path: '/blog/docker-secrets-injection' },
      ]),
      {
        '@type': 'BlogPosting',
        '@id': `${SITE_URL}/blog/docker-secrets-injection#post`,
        headline: 'Your Agentic Coding Tool is Reading Your Secrets',
        description: 'Why your coding agent should never see your secrets — and how Docker makes that possible.',
        url: `${SITE_URL}/blog/docker-secrets-injection`,
        mainEntityOfPage: `${SITE_URL}/blog/docker-secrets-injection`,
        datePublished: '2026-05-20',
        timeRequired: 'PT3M',
        keywords: ['Docker', 'Security', 'LLM Agents', 'Vibe Coding', 'DevOps'],
        author: personRef,
        isPartOf: { '@id': `${SITE_URL}/blog#blog` },
        inLanguage: 'en-US',
      },
    ),
  },

  '/apps': {
    ...meta('/apps', {
      title: 'Apps — Nikhil Kulkarni',
      description:
        'The Progress App: an iOS and Android app that helps people build difficult habits with friends, built with React Native, Firebase, and WebSockets.',
    }),
    jsonLd: graph(
      breadcrumb([{ name: 'Home', path: '/' }, { name: 'Apps', path: '/apps' }]),
      {
        '@type': 'SoftwareApplication',
        name: 'The Progress App',
        description: 'Build difficult habits with like-minded people.',
        url: 'https://apps.apple.com/us/app/the-progress-app/id6503723392',
        operatingSystem: 'iOS, Android',
        applicationCategory: 'LifestyleApplication',
        keywords: 'React Native, Firebase, In App Purchases, Websockets, Node.js',
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
        'A take-home analysis of 59 engineers across posthog/posthog over a 90-day window: feature owners, reviewers, and infra specialists, ranked and explained.',
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
          'A take-home analysis of 59 engineers across posthog/posthog over a 90-day window: feature owners, reviewers, and infra specialists, ranked and explained.',
        url: `${SITE_URL}/take-homes/weave`,
        mainEntityOfPage: `${SITE_URL}/take-homes/weave`,
        datePublished: '2026-03-15',
        keywords: ['Engineering Analytics', 'PostHog', 'Take-Home'],
        author: personRef,
        inLanguage: 'en-US',
      },
    ),
  },
};

export default routeMeta;
