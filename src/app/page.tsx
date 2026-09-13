import Link from 'next/link';

/**
 * The landing page said "Stage 4 machinery only — no practitioner or facility
 * journey is implemented yet" for far longer than that was true. It is a
 * signpost, not a marketing page: the only thing anyone can actually open is
 * the operations console.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Medilink</p>
      <h1 className="text-3xl font-semibold tracking-tight">
        Verified healthcare workforce management
      </h1>

      <p className="mt-4 text-muted">
        Fourteen of the eighteen specification modules are built and tested. The operations console
        below is the only interface so far — the practitioner and facility journeys exist as APIs
        and have no screens yet.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/admin"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Operations console
        </Link>
        <Link href="/api/v1/health" className="rounded border px-4 py-2 text-sm hover:bg-border/30">
          Health check
        </Link>
      </div>

      <p className="mt-10 text-xs text-muted">
        Locally, run <code>scripts/bootstrap-demo.ts</code> to create the operations, compliance and
        administrator accounts, then sign in. <code>docs/end-to-end.md</code> has the whole walk.
      </p>
    </main>
  );
}
