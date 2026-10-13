import { securityHeaders } from './src/lib/security-headers.mjs';

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
