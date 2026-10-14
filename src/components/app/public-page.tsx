import Link from 'next/link';
import { ArrowLeft, Stethoscope } from 'lucide-react';
import { TextSizeControl } from '@/components/app/text-size-control';

/**
 * The frame for a page anybody can read without signing in: terms, privacy
 * notice, contact. Plain on purpose; the person reading may be deciding whether
 * to trust Medilink with their licence and their phone number.
 */
export function PublicPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-5">
          <Link href="/" className="flex items-center gap-2 font-semibold text-primary" aria-label="Medilink home">
            <Stethoscope className="size-5" aria-hidden="true" />
            Medilink
          </Link>
          <TextSizeControl />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-8 space-y-10">{children}</div>
      </main>
      <footer className="border-t">
        <nav
          className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-5 py-6 text-sm text-muted-foreground"
          aria-label="Legal and contact"
        >
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy notice</Link>
          <Link href="/contact" className="hover:text-foreground">Contact</Link>
        </nav>
      </footer>
    </div>
  );
}
