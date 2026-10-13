import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  moduleLinkIsCurrent,
  PrimaryNavigationLinks,
} from "@/components/primary-navigation";
import { modules } from "@/lib/modules";

function currentHrefs(markup: string): string[] {
  return [...markup.matchAll(/<a\b([^>]*)>/g)]
    .map((match) => match[1] ?? "")
    .filter((attributes) => attributes.includes('aria-current="page"'))
    .map((attributes) => attributes.match(/href="([^"]+)"/)?.[1] ?? "");
}

describe("private primary navigation", () => {
  it("shows exactly one active module for each registered route", () => {
    for (const item of modules) {
      const markup = renderToStaticMarkup(
        <PrimaryNavigationLinks pathname={item.href} />,
      );

      expect(markup).toContain('aria-label="Primary"');
      expect(markup).toContain('aria-controls="private-primary-navigation"');
      expect(currentHrefs(markup)).toEqual([item.href]);
    }
  });

  it("offers one collapsible mobile menu", () => {
    const closed = renderToStaticMarkup(
      <PrimaryNavigationLinks pathname="/vault" />,
    );
    const open = renderToStaticMarkup(
      <PrimaryNavigationLinks mobileOpen pathname="/vault" />,
    );

    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain("Navigate");
    expect(closed).toContain("Vault");
    expect(closed).toContain(
      'class="hidden max-h-[60vh] flex-col gap-2 overflow-y-auto',
    );
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain(
      'class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto',
    );
    expect(currentHrefs(open)).toEqual(["/vault"]);
    expect((open.match(/aria-label="Primary"/g) ?? [])).toHaveLength(1);
    expect((open.match(/href="\/vault"/g) ?? [])).toHaveLength(1);
  });

  it("keeps the root dashboard distinct from nested module routes", () => {
    expect(moduleLinkIsCurrent("/vault/core", "/")).toBe(false);
    expect(moduleLinkIsCurrent("/vault/core", "/vault")).toBe(true);
    expect(moduleLinkIsCurrent("/vault-performance", "/vault")).toBe(false);

    const nested = renderToStaticMarkup(
      <PrimaryNavigationLinks pathname="/vault/core" />,
    );
    expect(currentHrefs(nested)).toEqual(["/vault"]);

    const sibling = renderToStaticMarkup(
      <PrimaryNavigationLinks pathname="/vault-performance" />,
    );
    expect(currentHrefs(sibling)).toEqual(["/vault-performance"]);
  });

  it("does not claim an active page when the pathname is unresolved", () => {
    const unknown = renderToStaticMarkup(
      <PrimaryNavigationLinks pathname="/not-a-module" />,
    );
    const unavailable = renderToStaticMarkup(
      <PrimaryNavigationLinks pathname={null} />,
    );

    expect(unknown).toContain("Choose module");
    expect(unavailable).toContain("Choose module");
    expect(currentHrefs(unknown)).toEqual([]);
    expect(currentHrefs(unavailable)).toEqual([]);
  });
});
