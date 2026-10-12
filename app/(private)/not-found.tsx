import Link from "next/link";

export default function PrivateNotFound() {
  return (
    <section
      aria-labelledby="private-not-found-title"
      className="max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <h1 className="text-2xl font-semibold" id="private-not-found-title">
        Private page not found
      </h1>
      <p className="mt-3 leading-7 text-[var(--muted)]">
        The requested page is unavailable or does not exist. No private data is
        shown here.
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        This view does not confirm whether an earlier save or import completed.
        Check its recorded status before repeating that operation.
      </p>
      <Link
        className="mt-6 inline-flex rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
        href="/"
      >
        Return to dashboard
      </Link>
    </section>
  );
}
