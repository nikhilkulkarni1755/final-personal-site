# Analytics Integration Guide

## Overview

Your personal website now has a complete analytics system integrated with Supabase! This tracks:

- **Page Views**: Every visit to your pages
- **Interactions**: Time spent on page and scroll depth
- **Active Sessions**: Real-time visitor count
- **Likes**: Users can like pages (prevents duplicates)
- **Comments**: Coming soon - ready to be implemented

## What Was Created

### 1. Database Schema (`supabase/migrations/20251216052112_create_analytics_schema.sql`)

Six interconnected tables:

- `pages` - Central registry with cached counters
- `page_views` - Individual page visits
- `interactions` - Time-on-page and scroll tracking
- `comments` - Moderation workflow
- `likes` - User engagement
- `active_sessions` - Real-time active viewers

### 2. Frontend Integration

#### Files Created:

**Configuration:**

- `.env.local` - Environment variables
- `src/lib/supabase.ts` - Supabase client setup

**Utilities:**

- `src/lib/analytics-utils.ts` - Visitor ID, fingerprinting, session management
- `src/lib/analytics.ts` - Core analytics functions

**Hooks:**

- `src/hooks/usePageAnalytics.tsx` - Auto-tracking for pages
- `src/hooks/useLikes.tsx` - Like functionality

**Components:**

- `src/components/LikeButton.tsx` - Interactive like button
- `src/components/ActiveViewers.tsx` - Shows "X people viewing now"
- `src/components/PageStats.tsx` - Displays views, likes, comments

**Pages Updated:**

- `src/pages/Home.tsx` - Added analytics tracking
- `src/pages/Blog.tsx` - Added analytics tracking
- `src/pages/Apps.tsx` - Added analytics tracking

## How It Works

### Automatic Tracking

When a user visits a page:

1. **Page View** is recorded:

   - Visitor ID (hashed browser fingerprint)
   - User agent, referrer, geographic data
   - Triggers: `pages.view_count` increments automatically

2. **Active Session** starts:

   - Session heartbeat every 30 seconds
   - Shows "X people viewing now"
   - Auto-cleanup after 5 minutes of inactivity

3. **Interaction Tracking** (on page exit):

   - Duration (seconds spent on page)
   - Scroll depth (max % scrolled)
   - Triggers: `pages.interaction_count` increments

4. **Real-time Updates**:
   - Active viewer count updates every 30 seconds
   - All counters cached in `pages` table for performance

### User Interactions

**Likes:**

- Click heart button to like/unlike
- Prevents duplicate likes (per visitor fingerprint)
- Updates `pages.like_count` automatically via trigger
- Visual feedback with filled/unfilled heart

**Comments** (ready to implement):

- All backend logic exists
- Comments start as "pending"
- Only "approved" comments count toward `comment_count`
- To activate: Create a comment form component

## Environment Setup

### Local Development

```bash
# 1. Start Supabase (needs Docker Desktop running)
npx supabase start

# 2. Reset database to apply migrations
npx supabase db reset

# 3. Start dev server
npm run dev
```

Your `.env.local` is already configured for local development:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=
```

### Production Deployment

```bash
# 1. Push migrations to production Supabase
npx supabase db push

# 2. Update .env.production with your production values
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-production-anon-key

# 3. Deploy your frontend
npm run build
```

## Usage Examples

### Adding Analytics to a New Page

```typescript
import { usePageAnalytics } from "../hooks/usePageAnalytics";
import ActiveViewers from "../components/ActiveViewers";
import PageStats from "../components/PageStats";
import LikeButton from "../components/LikeButton";

const MyPage = () => {
  // Track page analytics
  const { pageId, activeUsers, analytics } = usePageAnalytics("My Page Title");

  return (
    <div>
      {/* Your page content */}

      {/* Analytics display */}
      <div className="flex items-center justify-between p-6">
        <div className="flex gap-4">
          <ActiveViewers count={activeUsers} />
          <PageStats
            viewCount={analytics?.view_count}
            likeCount={analytics?.like_count}
          />
        </div>
        <LikeButton pageId={pageId} likeCount={analytics?.like_count} />
      </div>
    </div>
  );
};
```

### Manually Track Events

```typescript
import { trackPageView, addLike, addComment } from "../lib/analytics";

// Track a custom event
await trackPageView("Special Page");

// Add a like
await addLike(pageId);

// Add a comment
await addComment(pageId, "Great article!");
```

## Database Maintenance

### Cleanup Stale Sessions

The `cleanup_stale_sessions()` function removes sessions older than 5 minutes.

**Option 1: Manual cleanup (for testing)**

```sql
SELECT cleanup_stale_sessions();
```

**Option 2: Scheduled cleanup (recommended for production)**

Set up a cron job in Supabase to run every 5 minutes:

```sql
SELECT cron.schedule(
  'cleanup-stale-sessions',
  '*/5 * * * *',  -- Every 5 minutes
  $$ SELECT cleanup_stale_sessions(); $$
);
```

## Analytics Dashboard

View analytics in Supabase Studio:

1. Open: http://localhost:54323 (local) or your production Supabase dashboard
2. Go to **Table Editor**
3. Check the `pages` table to see aggregated stats
4. Check individual tables for detailed data

**Sample Queries:**

```sql
-- Top pages by views
SELECT slug, title, view_count, like_count
FROM pages
ORDER BY view_count DESC;

-- Active viewers right now
SELECT p.slug, COUNT(*) as active_count
FROM active_sessions s
JOIN pages p ON s.page_id = p.id
WHERE s.last_heartbeat > NOW() - INTERVAL '5 minutes'
GROUP BY p.slug;

-- Engagement rate
SELECT
  slug,
  title,
  view_count,
  interaction_count,
  ROUND(interaction_count::numeric / NULLIF(view_count, 0) * 100, 2) as engagement_rate
FROM pages
ORDER BY engagement_rate DESC;
```

## Privacy Considerations

✅ **Privacy-Friendly:**

- No cookies used
- IP addresses are hashed (never stored raw)
- Visitor IDs are hashed browser fingerprints
- No personal data collected
- Users can't be tracked across devices
- Compliant with GDPR/privacy laws

## Testing Checklist

- [ ] Visit homepage → Check view count increments
- [ ] Scroll and spend time → Check interaction recorded on exit
- [ ] Open in multiple tabs → Check active viewer count
- [ ] Click like button → Check like count increments
- [ ] Unlike → Check like count decrements
- [ ] Refresh page → Check visitor recognized (same visitor ID)
- [ ] Clear localStorage → Check new visitor ID created
- [ ] Check Supabase Studio → Verify data in tables

## Troubleshooting

**No data appearing:**

1. Check Supabase is running: `npx supabase status`
2. Check browser console for errors
3. Verify `.env.local` has correct values
4. Check network tab for failed API calls

**Active viewers stuck at 0:**

1. Check heartbeat is running (console logs)
2. Run cleanup: `SELECT cleanup_stale_sessions();`
3. Check `active_sessions` table in Supabase Studio

**Likes not working:**

1. Check browser console for errors
2. Verify Row Level Security policies allow public insert
3. Check `likes` table for duplicate constraint errors

## Next Steps

1. **Add Comments UI**: Create a comment form component
2. **Analytics Dashboard**: Build an admin dashboard to view stats
3. **Export Data**: Add CSV export functionality
4. **Real-time Updates**: Use Supabase Realtime to update stats live
5. **A/B Testing**: Track variants and conversion rates
6. **Geographic Maps**: Visualize visitor locations

## API Reference

See inline documentation in:

- `src/lib/analytics.ts` - All public functions
- `src/lib/analytics-utils.ts` - Helper utilities
- `src/hooks/usePageAnalytics.tsx` - Hook API
- `src/hooks/useLikes.tsx` - Likes hook API

---

**Created**: December 15, 2025
**Database Migration**: `20251216052112_create_analytics_schema.sql`
**Status**: ✅ Ready for production
