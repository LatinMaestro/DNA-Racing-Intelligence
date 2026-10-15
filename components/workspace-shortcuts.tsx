import Link from "next/link";

const workspaces = [
  ["/vault", "My Vault", "Browse owned Cores and their race evidence."],
  [
    "/pro-league",
    "Pro League",
    "Review roster, map coverage and race mappings.",
  ],
  ["/breeding", "Breeding", "Find assessed pairs and compare parent evidence."],
  [
    "/vault-performance",
    "Vault Performance",
    "Review recorded economics where connected.",
  ],
] as const;

export function WorkspaceShortcuts() {
  return (
    <section aria-labelledby="workspace-shortcuts" className="space-y-4">
      <h2 id="workspace-shortcuts" className="text-xl font-semibold">
        Open your workspace
      </h2>
      <form
        action="/search-core"
        method="get"
        role="search"
        className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 sm:flex-row sm:items-end"
      >
        <label className="flex-1 text-sm font-semibold">
          Find a Core
          <input
            className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            name="q"
            type="search"
            maxLength={128}
            autoComplete="off"
            placeholder="Core name or exact Core ID"
            required
          />
        </label>
        <button
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Search Core
        </button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {workspaces.map(([href, title, description]) => (
          <Link
            key={href}
            href={href}
            prefetch={false}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
