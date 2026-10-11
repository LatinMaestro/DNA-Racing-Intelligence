"use client";

import Link from "next/link";

export default function PrivatePageError({
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  return (
    <section
      aria-labelledby="private-page-error-title"
      className="max-w-3xl rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      role="alert"
    >
      <h1 className="text-2xl font-semibold" id="private-page-error-title">
        Unable to display this private page
      </h1>
      <p className="mt-3 leading-7 text-[var(--muted)]">
        The page could not be loaded. Its data freshness and coverage are
        unverified until the view becomes available again.
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        A failed page does not confirm whether an earlier save or import
        completed. Check its recorded status before repeating that operation.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
          onClick={reset}
          type="button"
        >
          Retry page
        </button>
        <Link
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
          href="/"
        >
          Return to dashboard
        </Link>
      </div>
    </section>
  );
}
