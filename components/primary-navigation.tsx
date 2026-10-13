"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { modules, type ModuleHref } from "@/lib/modules";

const navigationId = "private-primary-navigation";
const linkClassName =
  "w-full rounded-lg border px-3 py-2 text-sm transition hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--text)]";
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

function currentModuleLabel(pathname: string | null): string {
  return (
    modules.find((item) => moduleLinkIsCurrent(pathname, item.href))?.label ??
    "Choose module"
  );
}

export function PrimaryNavigationLinks({
  pathname,
  mobileOpen = false,
  onNavigate,
  onToggle,
}: Readonly<{
  pathname: string | null;
  mobileOpen?: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
}>) {
  return (
    <>
      <button
        aria-controls={navigationId}
        aria-expanded={mobileOpen}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-sm font-semibold lg:hidden"
        onClick={onToggle}
        type="button"
      >
        <span>Navigate</span>
        <span className="truncate font-normal text-[var(--muted)]">
          {currentModuleLabel(pathname)}
        </span>
      </button>
      <nav
        aria-label="Primary"
        className={[
          mobileOpen ? "flex" : "hidden",
          "max-h-[60vh] flex-col gap-2 overflow-y-auto pt-3 lg:flex lg:max-h-none lg:overflow-visible lg:pt-0",
        ].join(" ")}
        id={navigationId}
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
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function PrimaryNavigation() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <PrimaryNavigationLinks
      mobileOpen={mobileOpen}
      onNavigate={() => setMobileOpen(false)}
      onToggle={() => setMobileOpen((open) => !open)}
      pathname={pathname}
    />
  );
}
