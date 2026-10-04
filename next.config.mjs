/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
