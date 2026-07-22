import type { ModuleHref } from "@/lib/modules";
import { modules } from "@/lib/modules";

type ModulePlaceholderProps = {
  href: Exclude<ModuleHref, "/">;
  source?: "Race" | "Vault" | "Arena" | "Core";
  boundary: string;
};

export function ModulePlaceholder({
  href,
  source,
  boundary,
}: ModulePlaceholderProps) {
  const moduleDefinition = modules.find((item) => item.href === href);

  if (!moduleDefinition) return null;

  return (
    <div className="space-y-7">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 0 scaffold
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {moduleDefinition.label}
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          {moduleDefinition.shortDescription}
        </p>
      </header>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">Current boundary</h2>
        <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
          {boundary}
        </p>
      </section>
      {source ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          {source} freshness fields are reserved here and will remain empty
          until an accepted import exists.
        </div>
      ) : null}
    </div>
  );
}
