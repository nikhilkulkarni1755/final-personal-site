import { useEffect, useRef, useState } from 'react';
import {
  trackPageView,
  trackInteraction,
  updateActiveSession,
  removeActiveSession,
  getActiveSessionCount,
  getPageAnalytics,
} from '../lib/analytics';
import { getPageSlug } from '../lib/analytics-utils';

/**
 * Hook to automatically track page views, interactions, and active sessions
 */
export function usePageAnalytics(pageTitle: string) {
  const [pageId, setPageId] = useState<string | null>(null);
  const [pageViewId, setPageViewId] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<number>(0);
  const [analytics, setAnalytics] = useState<any>(null);

  const startTime = useRef<number>(Date.now());
  const maxScroll = useRef<number>(0);
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Track page view on mount
    const initTracking = async () => {
      const result = await trackPageView(pageTitle);

      if (result) {
        setPageViewId(result.pageViewId);
        setPageId(result.pageId);

        // Start heartbeat for active session
        if (result.pageId) {
          await updateActiveSession(result.pageId);

          heartbeatInterval.current = setInterval(async () => {
            await updateActiveSession(result.pageId);

            // Update active user count
            const count = await getActiveSessionCount(result.pageId);
            setActiveUsers(count);
          }, 30000); // Update every 30 seconds

          // Get initial active user count
          const count = await getActiveSessionCount(result.pageId);
          setActiveUsers(count);

          // Get page analytics
          const slug = getPageSlug();
          const analyticsData = await getPageAnalytics(slug);
          setAnalytics(analyticsData);
        }
      }
    };

    initTracking();

    // Track scroll depth
    const handleScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY;
      const scrollPercent = (scrollTop / (documentHeight - windowHeight)) * 100;

      maxScroll.current = Math.max(maxScroll.current, scrollPercent);
    };

    window.addEventListener('scroll', handleScroll);

    // Track interaction on unmount
    return () => {
      window.removeEventListener('scroll', handleScroll);

      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }

      if (pageViewId && pageId) {
        const duration = (Date.now() - startTime.current) / 1000;
        trackInteraction(pageViewId, pageId, duration, maxScroll.current);
      }

      // Remove active session
      removeActiveSession();
    };
  }, [pageTitle]); // Only run once on mount

  return {
    pageId,
    activeUsers,
    analytics,
  };
}
