import type { Metadata, Viewport } from 'next';
import { Providers } from '@/lib/ui/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Medilink', template: '%s · Medilink' },
  description: 'Verified healthcare workforce and locum management for Nigeria.',
  applicationName: 'Medilink',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#01696f',
  width: 'device-width',
  initialScale: 1,
};

/**
 * The reader's text size and the console's theme, applied before the first paint.
 *
 * Both used to be applied in an effect after hydration, so a person on large text saw the page
 * at normal size, then watched it jump; and a person in dark mode got a white flash on every
 * navigation. This is a few lines, inline, because nothing external can run before paint.
 * Dark applies only inside the consoles — the public pages are light by design, and the shell
 * removes the class again on the way out (see console-shell.tsx).
 */
const PREPAINT = `(function(){try{var d=document.documentElement;var s=localStorage.getItem('medilink:text-size');if(s==='large'||s==='projector')d.setAttribute('data-text-size',s);if(/^\\/(admin|facility|practitioner)(\\/|$)/.test(location.pathname)&&localStorage.getItem('medilink:theme')==='dark')d.classList.add('dark')}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script above sets attributes on <html> before React sees it.
    <html lang="en-NG" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
