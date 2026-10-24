import type { MetadataRoute } from 'next';

// Read at request time, so the address is the one the site is actually served from.
export const dynamic = 'force-dynamic';

/**
 * What a search engine may read: the public pages. The consoles and the API are behind a sign-in and
 * have nothing to index, and listing them here would only advertise where they are.
 */
export default function robots(): MetadataRoute.Robots {
  const site = process.env.APP_URL ?? 'http://localhost:3000';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/facility', '/practitioner', '/api/'] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
