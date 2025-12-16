/**
 * Generates a simple browser fingerprint for visitor identification
 * This is privacy-friendly and doesn't collect sensitive data
 */
export function generateFingerprint(): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Collect browser characteristics
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    !!window.sessionStorage,
    !!window.localStorage,
  ];

  // Add canvas fingerprint
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('fingerprint', 2, 2);
    components.push(canvas.toDataURL());
  }

  return components.join('|||');
}

/**
 * Simple hash function for strings
 */
export async function hashString(str: string): Promise<string> {
  // Use Web Crypto API for hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a unique session ID
 */
export function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Gets or creates a visitor ID (stored in localStorage)
 */
export async function getVisitorId(): Promise<string> {
  const VISITOR_ID_KEY = 'analytics_visitor_id';

  let visitorId = localStorage.getItem(VISITOR_ID_KEY);

  if (!visitorId) {
    visitorId = await hashString(generateFingerprint());
    localStorage.setItem(VISITOR_ID_KEY, visitorId);
  }

  return visitorId;
}

/**
 * Gets or creates a session ID (stored in sessionStorage)
 */
export function getSessionId(): string {
  const SESSION_ID_KEY = 'analytics_session_id';

  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);

  if (!sessionId) {
    sessionId = generateSessionId();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  }

  return sessionId;
}

/**
 * Gets the current page slug from the pathname
 */
export function getPageSlug(): string {
  return window.location.pathname;
}

/**
 * Determines the page type based on the slug
 */
export function getPageType(slug: string): string {
  if (slug === '/') return 'home';
  if (slug === '/blog') return 'blog_index';
  if (slug.startsWith('/blog/')) return 'blog_post';
  if (slug === '/apps') return 'apps';
  if (slug === '/projects') return 'projects';
  if (slug === '/about') return 'about';
  return 'other';
}

/**
 * Gets anonymous fingerprint for likes/comments (uses visitor ID)
 */
export async function getAnonymousFingerprint(): Promise<string> {
  return await getVisitorId();
}
