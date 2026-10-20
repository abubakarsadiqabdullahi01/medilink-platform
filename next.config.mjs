import { existsSync, readdirSync } from 'node:fs';
import { securityHeaders } from './src/lib/security-headers.mjs';

/**
 * Which optional pictures exist, found when the app is built (see src/lib/ui/images.ts).
 *
 * The illustrations and the sign-in photograph are delivered separately from the code. Asking the
 * browser to discover that a file is missing means a request that can only fail, a broken image for
 * a moment and a layout that moves; asking the build means none of that. Drop a file into
 * public/images and rebuild, and it appears.
 */
function availableImages() {
  const found = [];
  for (const folder of ['auth', 'empty']) {
    const dir = `public/images/${folder}`;
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) if (file.endsWith('.webp')) found.push(`${folder}/${file}`);
  }
  return found.join(',');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Where the build goes. Only the browser journeys' server changes it
   * (docker-compose.yml, service `e2e`), so it can build and serve beside the
   * dev server without either one overwriting the other's output — a
   * production build written into the dev server's `.next` breaks it.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  env: { NEXT_PUBLIC_IMAGES: availableImages() },
  /**
   * Page metadata in the <head>, for everybody.
   *
   * By default Next streams the metadata of a dynamic page into the body after the content, and only
   * puts it in the head for the crawlers on its own list. A browser does not care, but a link preview,
   * Lighthouse and any crawler not on the list read the head and found no description. The metadata
   * here is static, so waiting for it costs nothing; every visitor is treated as one that needs it.
   */
  htmlLimitedBots: /.*/,
  /**
   * @node-rs/argon2 resolves to a prebuilt native .node addon. Webpack has
   * no loader for that binary and fails the route at compile time, so the
   * package must be required at runtime by Node instead of bundled. Any
   * future native dependency belongs on this list too.
   *
   * Was `experimental.serverComponentsExternalPackages`, which Next 15
   * renamed. It was still under `experimental`, where Next ignores unknown
   * keys with a warning rather than an error — so the setting had quietly
   * stopped applying.
   */
  serverExternalPackages: ['@node-rs/argon2'],
  async headers() {
    return [
      {
        source: '/:path*',
        // Built in ./src/lib/security-headers.mjs, where the rules are tested.
        headers: securityHeaders(),
      },
    ];
  },
};

export default nextConfig;
