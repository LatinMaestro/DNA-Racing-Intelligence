"use client";

import { useEffect, useRef } from "react";

export default function GlobalError({
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <html lang="en-AU">
      <body>
        <main
          className="mx-auto flex min-h-screen max-w-3xl items-center p-5 sm:p-8"
          id="main-content"
        >
          <section
            aria-labelledby="global-error-title"
            className="w-full rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
            role="alert"
          >
            <p className="text-xs font-bold tracking-[0.22em] text-[var(--accent)] uppercase">
              Private intelligence
            </p>
            <h1
              className="mt-3 text-2xl font-semibold"
              id="global-error-title"
              ref={titleRef}
              tabIndex={-1}
            >
              Unable to open DNA Racing Intelligence
            </h1>
            <p className="mt-3 leading-7 text-[var(--muted)]">
              The private application shell could not be loaded. Data freshness
              and coverage are unverified until the site becomes available
              again.
            </p>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              This failure does not confirm whether an earlier save or import
              completed. Check its recorded status before repeating that
              operation.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
                onClick={reset}
                type="button"
              >
                Retry application
              </button>
              <a
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
                href="/"
              >
                Return to dashboard
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
