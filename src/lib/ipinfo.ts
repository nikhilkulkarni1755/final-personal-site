import { hashString } from './analytics-utils';

/**
 * IPInfo response type
 */
export interface IPInfoResponse {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  timezone?: string;
}

/**
 * Location data to save to database
 */
export interface LocationData {
  ip_hash: string;
  city: string | null;
  state: string | null;
  country: string | null;
}

/**
 * Fetches location data from IPInfo API
 * Uses the client's IP address automatically
 */
export async function fetchLocationData(): Promise<LocationData | null> {
  try {
    // IPInfo token - will be available from Cloudflare Pages environment
    // Falls back to free tier if token not available
    const token = import.meta.env.IPINFO_KEY || '';

    // IPInfo's endpoint - when called without an IP, it returns info for the caller's IP
    const url = token
      ? `https://ipinfo.io/json?token=${token}`
      : 'https://ipinfo.io/json';

    const response = await fetch(url);

    if (!response.ok) {
      console.error('IPInfo API error:', response.status, response.statusText);
      return null;
    }

    const data: IPInfoResponse = await response.json();

    // Hash the IP address for privacy
    const ip_hash = await hashString(data.ip);

    return {
      ip_hash,
      city: data.city || null,
      state: data.region || null,
      country: data.country || null,
    };
  } catch (error) {
    console.error('Error fetching location data from IPInfo:', error);
    return null;
  }
}
