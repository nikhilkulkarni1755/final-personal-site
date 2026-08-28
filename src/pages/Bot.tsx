import { motion } from 'framer-motion';
import { Bot as BotIcon } from 'lucide-react';
import { usePageAnalytics } from '../hooks/usePageAnalytics';

const UA_STRING = 'InterestingFindsBot/1.0 (+https://nikhilkulkarni1755.com/bot.txt)';

/**
 * Public disclosure for InterestingFindsBot, the crawler behind the
 * Interesting Finds pipeline. Required per finds-coord's R2-permission-
 * rubric.md §2.4 -- every real crawler publishes one, and it is the only
 * thing that makes the "+URL" in our User-Agent worth anything.
 *
 * The load-bearing copy is public/bot.txt: a plain-text file that serves
 * correctly to curl today, unlike this route (the SPA catch-all in
 * public/_redirects returns index.html to any client without JS). This page
 * is the human-readable twin for a browser. Keep both in sync by hand --
 * there's no shared build step between a static file and this component.
 */
const Bot = () => {
  usePageAnalytics('Bot Disclosure');

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="flex items-center justify-center mb-4">
            <BotIcon className="w-12 h-12 text-[#001F3F] dark:text-white" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#001F3F] dark:text-white mb-4">
            Interesting Finds Bot
          </h1>
          <p className="text-lg text-[#001F3F]/70 dark:text-white/70">Last updated: August 28, 2026</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="prose prose-lg max-w-none"
        >
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">Who operates it</h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              I'm Nikhil Kulkarni, and I operate this bot myself for my own personal site,{' '}
              <a href="https://nikhilkulkarni1755.com" className="underline hover:opacity-70 transition-opacity">
                nikhilkulkarni1755.com
              </a>
              . One person's pipeline -- not a company, and not a third-party crawling service.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">
              What it does, and why
            </h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              Every day this pipeline pulls a short list of newly-launched products from public
              sources (Peerlist, Show HN, GitHub, and similar). For each one it reads the product's
              own homepage and a handful of sub-pages -- pricing, docs, about -- to check whether
              what it advertises is actually true, whether it solves a real problem, whether anyone
              can use it, and whether it is agent/MCP friendly. Only products that pass get
              published, by hand, on{' '}
              <a
                href="/interesting-finds"
                className="underline hover:opacity-70 transition-opacity"
              >
                Interesting Finds
              </a>{' '}
              with a link back to the maker's own site. Nothing this bot reads is used to train a
              model.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">
              User-Agent and how to block it
            </h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mb-4">
              Sent byte-for-byte on every request this bot makes, robots.txt included:
            </p>
            <pre className="bg-[#001F3F]/5 dark:bg-white/5 rounded-lg p-4 overflow-x-auto text-sm text-[#001F3F] dark:text-white">
              {UA_STRING}
            </pre>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed my-4">
              Releases bump only the version number -- the product token never changes, and a
              second User-Agent is never sent after a block. To keep it out entirely, add this to
              your robots.txt:
            </p>
            <pre className="bg-[#001F3F]/5 dark:bg-white/5 rounded-lg p-4 overflow-x-auto text-sm text-[#001F3F] dark:text-white">
{`User-agent: InterestingFindsBot
Disallow: /`}
            </pre>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mt-4">
              robots.txt is re-read on every run, so a block takes effect on the very next visit.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">
              What it will not do
            </h2>
            <ul className="space-y-2 text-[#001F3F]/80 dark:text-white/80">
              <li className="flex">
                <span className="mr-2">&bull;</span>
                <span>GET and HEAD requests only -- never POST, PUT, PATCH, or DELETE</span>
              </li>
              <li className="flex">
                <span className="mr-2">&bull;</span>
                <span>Never logs in, signs up, checks out, or submits a form</span>
              </li>
              <li className="flex">
                <span className="mr-2">&bull;</span>
                <span>Never sends a cookie, an Authorization header, or an API key</span>
              </li>
              <li className="flex">
                <span className="mr-2">&bull;</span>
                <span>Never spoofs a browser User-Agent or claims to be anything else</span>
              </li>
              <li className="flex">
                <span className="mr-2">&bull;</span>
                <span>At most 25 pages per site, at least 2 seconds apart</span>
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">
              Signals it honours
            </h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              robots.txt (including <code>Crawl-delay</code>), <code>X-Robots-Tag</code>,{' '}
              <code>&lt;meta name="robots"&gt;</code>, <code>Content-Signal</code>,{' '}
              <code>Content-Usage</code>, and TDM-reservation headers. When a site's own signals
              say no, this bot does not fetch that page. Full stop.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">
              Opt out or complain
            </h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              Email{' '}
              <a
                href="mailto:nikhilkulkarni1755@gmail.com"
                className="underline hover:opacity-70 transition-opacity"
              >
                nikhilkulkarni1755@gmail.com
              </a>
              . Any request lands your domain on a permanent denylist, no argument -- in addition
              to, not instead of, an ordinary robots.txt block.
            </p>
          </section>

          <p className="text-sm text-[#001F3F]/60 dark:text-white/60">
            Also available as plain text at{' '}
            <a href="/bot.txt" className="underline hover:opacity-70 transition-opacity">
              /bot.txt
            </a>{' '}
            -- the version a script actually reads.
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Bot;
