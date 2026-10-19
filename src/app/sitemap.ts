import type { MetadataRoute } from 'next';

export const dynamic = 'force-dynamic';

/** The pages anybody can read. Everything else needs a sign-in. */
const PAGES = ['/', '/login', '/register', '/contact', '/privacy', '/terms'];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.APP_URL ?? 'http://localhost:3000';
  return PAGES.map((path) => ({ url: `${site}${path}` }));
}
