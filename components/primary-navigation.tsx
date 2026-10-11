"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { modules, type ModuleHref } from "@/lib/modules";

const linkClassName =
  "min-w-max rounded-lg border px-3 py-2 text-sm transition hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--text)]";
const currentLinkClassName =
  "border-[var(--accent)] bg-[var(--surface-raised)] font-semibold text-[var(--text)]";
const inactiveLinkClassName = "border-transparent text-[var(--muted)]";

export function moduleLinkIsCurrent(
  pathname: string | null,
  href: ModuleHref,
): boolean {
  return (
    pathname === href ||
    (pathname !== null && href !== "/" && pathname.startsWith(href + "/"))
  );
}

export function PrimaryNavigationLinks({
  pathname,
}: Readonly<{ pathname: string | null }>) {
  return (
    <nav
      aria-label="Primary"
      className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible"
    >
      {modules.map((item) => {
        const current = moduleLinkIsCurrent(pathname, item.href);
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={[
              linkClassName,
              current ? currentLinkClassName : inactiveLinkClassName,
            ].join(" ")}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PrimaryNavigation() {
  const pathname = usePathname();
  return <PrimaryNavigationLinks pathname={pathname} />;
}
