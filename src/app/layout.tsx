import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Medilink',
  description: 'Verified healthcare workforce and locum management for Nigeria.',
  applicationName: 'Medilink',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#01696f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
