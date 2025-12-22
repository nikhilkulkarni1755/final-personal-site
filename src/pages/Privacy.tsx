import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import { usePageAnalytics } from '../hooks/usePageAnalytics';
import ActiveViewers from '../components/ActiveViewers';
import PageStats from '../components/PageStats';
import LikeButton from '../components/LikeButton';

const Privacy = () => {
  // Track page analytics
  const { pageId, activeUsers, analytics } = usePageAnalytics('Privacy Policy');

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="flex items-center justify-center mb-4">
            <Shield className="w-12 h-12 text-[#001F3F] dark:text-white" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#001F3F] dark:text-white mb-4">
            Privacy Policy
          </h1>
          <p className="text-lg text-[#001F3F]/70 dark:text-white/70">
            Last Updated: December 21 2025
          </p>
        </motion.div>

        {/* Privacy Policy Content */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="prose prose-lg prose-navy dark:prose-invert max-w-none"
        >
          {/* Overview */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">Overview</h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              This is a personal portfolio website owned and operated by Nikhil Kulkarni, demonstrating
              backend development capabilities. This privacy policy explains how I collect and handle
              information when you visit my site.
            </p>
          </section>

          {/* Information I Collect */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">
              Information I Collect
            </h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mb-4">
              I automatically collect basic technical information when you visit this site:
            </p>
            <ul className="space-y-2 text-[#001F3F]/80 dark:text-white/80">
              <li className="flex">
                <span className="mr-2">•</span>
                <span>IP addresses - for basic analytics and security monitoring</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Device types - browser and operating system information</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Page visits - which pages you view and when</span>
              </li>
            </ul>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mt-4">
              This information is collected automatically through standard web server logs and helps me
              understand site usage patterns and demonstrate analytics capabilities.
            </p>
          </section>

          {/* How I Use Your Information */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">
              How I Use Your Information
            </h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mb-4">
              I use this information solely for:
            </p>
            <ul className="space-y-2 text-[#001F3F]/80 dark:text-white/80 mb-4">
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Site performance monitoring</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Basic visitor analytics</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Demonstrating backend development skills</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Security and abuse prevention</span>
              </li>
            </ul>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mb-2">
              I do not:
            </p>
            <ul className="space-y-2 text-[#001F3F]/80 dark:text-white/80">
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Sell your information to anyone</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Share your data with third parties (except my hosting provider)</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Track you across other websites</span>
              </li>
              <li className="flex">
                <span className="mr-2">•</span>
                <span>Build detailed user profiles</span>
              </li>
            </ul>
          </section>

          {/* Data Storage */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">Data Storage</h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              All collected data is stored securely using Supabase, a cloud database service.
            </p>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mt-4">
              Data is retained indefinitely to support ongoing analytics and site improvement, unless you request deletion.
            </p>
          </section>

          {/* Your Rights */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">Your Rights</h2>

            <div className="mb-6">
              <h3 className="text-xl font-semibold text-[#001F3F] dark:text-white mb-3">
                For everyone:
              </h3>
              <ul className="space-y-2 text-[#001F3F]/80 dark:text-white/80">
                <li className="flex">
                  <span className="mr-2">•</span>
                  <span>You can request deletion of your data by emailing me your public IP address</span>
                </li>
                <li className="flex">
                  <span className="mr-2">•</span>
                  <span>You can ask what information I have collected about your visits</span>
                </li>
              </ul>
            </div>

            <div className="mb-6">
              <h3 className="text-xl font-semibold text-[#001F3F] dark:text-white mb-3">
                For EU visitors:
              </h3>
              <ul className="space-y-2 text-[#001F3F]/80 dark:text-white/80">
                <li className="flex">
                  <span className="mr-2">•</span>
                  <span>You have rights under GDPR including access, deletion, and portability of your data</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-[#001F3F] dark:text-white mb-3">
                For California residents:
              </h3>
              <ul className="space-y-2 text-[#001F3F]/80 dark:text-white/80">
                <li className="flex">
                  <span className="mr-2">•</span>
                  <span>You have rights under CCPA to know about and delete your personal information</span>
                </li>
                <li className="flex">
                  <span className="mr-2">•</span>
                  <span>I do not sell personal information</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Contact Me */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">Contact Me</h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mb-4">
              For any privacy-related questions or to request data deletion, contact me at:
            </p>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              Email: nikhilkulkarni1755@gmail.com
            </p>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mt-4">
              Please include your public IP address if requesting data deletion.
            </p>
          </section>

          {/* Updates */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-4">Updates</h2>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed">
              I may update this privacy policy occasionally. Any changes will be posted on this page
              with a new "Last Updated" date.
            </p>
            <p className="text-[#001F3F]/80 dark:text-white/80 leading-relaxed mt-4">
              This website is governed by the laws of California, United States.
            </p>
          </section>
        </motion.div>

        {/* Analytics Section */}
        <section className="mt-16">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-white/50 dark:bg-[#001F3F]/30 border border-[#001F3F]/10 dark:border-white/10 rounded-lg">
            <div className="flex flex-col sm:flex-row items-center gap-4 flex-1">
              <ActiveViewers count={activeUsers} />
              <PageStats
                viewCount={analytics?.view_count}
                likeCount={analytics?.like_count}
              />
            </div>
            <LikeButton pageId={pageId} likeCount={analytics?.like_count} />
          </div>
        </section>
      </div>
    </div>
  );
};

export default Privacy;
