import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  moduleLinkIsCurrent,
  PrimaryNavigationLinks,
} from "@/components/primary-navigation";
import { modules } from "@/lib/modules";

function currentHrefs(markup: string): string[] {
  return [...markup.matchAll(/<a\b([^>]*)>/g)]
    .filter(([, attributes]) => attributes.includes('aria-current="page"'))
    .map(([, attributes]) => attributes.match(/href="([^"]+)"/)?.[1] ?? "");
}

describe("private primary navigation", () => {
  it("shows exactly one active module for each registered route", () => {
    for (const item of modules) {
      const markup = renderToStaticMarkup(
        <PrimaryNavigationLinks pathname={item.href} />,
      );

      expect(markup).toContain('aria-label="Primary"');
      expect(markup).toContain("overflow-x-auto");
      expect(currentHrefs(markup)).toEqual([item.href]);
    }
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

    expect(currentHrefs(unknown)).toEqual([]);
    expect(currentHrefs(unavailable)).toEqual([]);
  });
});
