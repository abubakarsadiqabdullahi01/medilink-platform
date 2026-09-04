export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Medilink</p>
      <h1 className="text-3xl font-semibold">Foundations scaffold</h1>
      <p className="text-base leading-relaxed text-[hsl(var(--muted))]">
        Stage 4 machinery only: schema baseline, permissions and scope, audit log, outbox and
        object storage. No practitioner or facility journey is implemented yet.
      </p>
      <a className="text-[hsl(var(--primary))] underline" href="/api/v1/health">
        Health check
      </a>
    </main>
  );
}
