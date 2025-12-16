import { supabase } from './supabase';
import {
  getVisitorId,
  getSessionId,
  getPageSlug,
  getPageType,
  getAnonymousFingerprint,
} from './analytics-utils';

/**
 * Ensures a page exists in the database, creates it if it doesn't
 */
async function ensurePageExists(slug: string, title: string) {
  const type = getPageType(slug);

  // Check if page exists
  const { data: existingPage } = await supabase
    .from('pages')
    .select('id')
    .eq('slug', slug)
    .single();

  if (existingPage) {
    return existingPage.id;
  }

  // Create page if it doesn't exist
  const { data: newPage, error } = await supabase
    .from('pages')
    .insert({ slug, title, type })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating page:', error);
    throw error;
  }

  return newPage.id;
}

/**
 * Tracks a page view
 */
export async function trackPageView(pageTitle: string) {
  try {
    const slug = getPageSlug();
    const visitorId = await getVisitorId();

    // Ensure page exists
    const pageId = await ensurePageExists(slug, pageTitle);

    // Insert page view
    const { data, error } = await supabase
      .from('page_views')
      .insert({
        page_id: pageId,
        visitor_id: visitorId,
        user_agent: navigator.userAgent,
        referrer: document.referrer || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error tracking page view:', error);
      return null;
    }

    return { pageViewId: data.id, pageId };
  } catch (error) {
    console.error('Error in trackPageView:', error);
    return null;
  }
}

/**
 * Tracks user interaction (time spent and scroll depth)
 */
export async function trackInteraction(
  pageViewId: string,
  pageId: string,
  durationSeconds: number,
  scrollDepthPercent: number
) {
  try {
    const { error } = await supabase.from('interactions').insert({
      page_view_id: pageViewId,
      page_id: pageId,
      duration_seconds: Math.round(durationSeconds),
      scroll_depth_percent: Math.min(100, Math.round(scrollDepthPercent)),
    });

    if (error) {
      console.error('Error tracking interaction:', error);
    }
  } catch (error) {
    console.error('Error in trackInteraction:', error);
  }
}

/**
 * Updates or creates an active session (heartbeat)
 */
export async function updateActiveSession(pageId: string) {
  try {
    const sessionId = getSessionId();

    const { error } = await supabase.from('active_sessions').upsert(
      {
        session_id: sessionId,
        page_id: pageId,
        last_heartbeat: new Date().toISOString(),
      },
      {
        onConflict: 'session_id',
      }
    );

    if (error) {
      console.error('Error updating active session:', error);
    }
  } catch (error) {
    console.error('Error in updateActiveSession:', error);
  }
}

/**
 * Removes active session when user leaves
 */
export async function removeActiveSession() {
  try {
    const sessionId = getSessionId();

    const { error } = await supabase
      .from('active_sessions')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      console.error('Error removing active session:', error);
    }
  } catch (error) {
    console.error('Error in removeActiveSession:', error);
  }
}

/**
 * Gets the count of active sessions for a page
 */
export async function getActiveSessionCount(pageId: string): Promise<number> {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from('active_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('page_id', pageId)
      .gte('last_heartbeat', fiveMinutesAgo);

    if (error) {
      console.error('Error getting active session count:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Error in getActiveSessionCount:', error);
    return 0;
  }
}

/**
 * Adds a like to a page
 */
export async function addLike(pageId: string) {
  try {
    const fingerprint = await getAnonymousFingerprint();

    const { error } = await supabase.from('likes').insert({
      page_id: pageId,
      anonymous_fingerprint: fingerprint,
    });

    if (error) {
      // Check if it's a duplicate like error
      if (error.code === '23505') {
        return { success: false, message: 'Already liked' };
      }
      console.error('Error adding like:', error);
      return { success: false, message: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in addLike:', error);
    return { success: false, message: 'Unknown error' };
  }
}

/**
 * Removes a like from a page
 */
export async function removeLike(pageId: string) {
  try {
    const fingerprint = await getAnonymousFingerprint();

    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('page_id', pageId)
      .eq('anonymous_fingerprint', fingerprint);

    if (error) {
      console.error('Error removing like:', error);
      return { success: false, message: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in removeLike:', error);
    return { success: false, message: 'Unknown error' };
  }
}

/**
 * Checks if the current user has liked a page
 */
export async function hasLiked(pageId: string): Promise<boolean> {
  try {
    const fingerprint = await getAnonymousFingerprint();

    const { data, error } = await supabase
      .from('likes')
      .select('id')
      .eq('page_id', pageId)
      .eq('anonymous_fingerprint', fingerprint)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "not found" error
      console.error('Error checking like status:', error);
    }

    return !!data;
  } catch (error) {
    console.error('Error in hasLiked:', error);
    return false;
  }
}

/**
 * Adds a comment to a page
 */
export async function addComment(pageId: string, content: string) {
  try {
    const fingerprint = await getAnonymousFingerprint();

    const { data, error } = await supabase
      .from('comments')
      .insert({
        page_id: pageId,
        anonymous_fingerprint: fingerprint,
        content,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding comment:', error);
      return { success: false, message: error.message };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Error in addComment:', error);
    return { success: false, message: 'Unknown error' };
  }
}

/**
 * Gets approved comments for a page
 */
export async function getComments(pageId: string) {
  try {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('page_id', pageId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error getting comments:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getComments:', error);
    return [];
  }
}

/**
 * Gets page analytics data
 */
export async function getPageAnalytics(slug: string) {
  try {
    const { data, error } = await supabase
      .from('pages')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
      console.error('Error getting page analytics:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getPageAnalytics:', error);
    return null;
  }
}
