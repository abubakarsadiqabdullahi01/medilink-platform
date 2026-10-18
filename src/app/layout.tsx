import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/lib/ui/providers';
import { THEME_INIT_SCRIPT } from '@/lib/ui/theme';
import './globals.css';

/**
 * One typeface, self-hosted.
 *
 * Plus Jakarta Sans as a single variable file (400–700, Latin, 27 kB), served from
 * this origin: no request to a font host, which on a weak connection is the
 * difference between text that arrives with the page and a flash of a different
 * font. `swap` shows the system font at once and replaces it when the file lands.
 *
 * Latin only, which covers English and Nigerian place names. Hausa's hooked letters
 * (ɓ, ɗ, ƙ) live in the Latin Extended-B block: when Hausa is added (UXA-12), add that
 * subset alongside this file, or they fall back to the system font.
 */
const sans = localFont({
  src: './fonts/PlusJakartaSans-latin-wght.woff2',
  variable: '--font-sans',
  weight: '400 700',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Medilink',
  description: 'Verified healthcare workforce and locum management for Nigeria.',
  applicationName: 'Medilink',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/apple-touch-icon.png' },
};

// The app's primary teal (--primary in globals.css), so the browser chrome, the
// installed app's title bar, the manifest and the icon all agree.
export const viewport: Viewport = {
  themeColor: '#0a6066',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning`: the script below adds `dark` to <html> before React
    // has hydrated, which is the point of it and not a mismatch.
    <html lang="en-NG" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
