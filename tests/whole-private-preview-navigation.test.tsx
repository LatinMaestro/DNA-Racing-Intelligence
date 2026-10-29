import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivatePageError from "@/app/(private)/error";
import PrivateNotFound from "@/app/(private)/not-found";
import { PrimaryNavigationLinks } from "@/components/primary-navigation";
import { modules } from "@/lib/modules";

const approvedPrivateRoutes = [
  "/",
  "/imports",
  "/api-sync",
  "/vault",
  "/search-core",
  "/core-intelligence",
  "/discovery",
  "/tournaments",
  "/pro-league",
  "/maiden",
  "/breeding",
  "/lifecycle",
  "/open-race",
  "/vault-performance",
  "/readiness",
] as const;

function hrefs(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*href="([^"]+)"/gu)].map(
    (match) => match[1]!,
  );
}

function currentHrefs(markup: string): string[] {
  return [...markup.matchAll(/<a\b([^>]*)>/gu)]
    .map((match) => match[1] ?? "")
    .filter((attributes) => attributes.includes('aria-current="page"'))
    .map((attributes) => attributes.match(/href="([^"]+)"/u)?.[1] ?? "");
}

describe("whole private Preview navigation acceptance", () => {
  it("keeps every approved module in one accessible mobile and desktop navigation model", () => {
    expect(modules.map(({ href }) => href)).toEqual(approvedPrivateRoutes);

    for (const route of approvedPrivateRoutes) {
      const closed = renderToStaticMarkup(
        <PrimaryNavigationLinks pathname={route} />,
      );
      const open = renderToStaticMarkup(
        <PrimaryNavigationLinks mobileOpen pathname={route} />,
      );

      expect(closed).toContain('aria-expanded="false"');
      expect(open).toContain('aria-expanded="true"');
      expect(open).toContain('aria-controls="private-primary-navigation"');
      expect(open).toContain('aria-label="Primary"');
      expect(hrefs(open)).toEqual(approvedPrivateRoutes);
      expect(currentHrefs(open)).toEqual([route]);
    }
  });

  it("provides private, accessible recovery without exposing provider details", () => {
    const privateError = Object.assign(
      new Error("SYNTHETIC_PROVIDER_SECRET_DETAIL"),
      { digest: "SYNTHETIC_PRIVATE_DIGEST" },
    );
    const errorMarkup = renderToStaticMarkup(
      <PrivatePageError error={privateError} reset={() => {}} />,
    );
    const missingMarkup = renderToStaticMarkup(<PrivateNotFound />);

    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("Retry page");
    expect(errorMarkup).toContain('href="/"');
    expect(missingMarkup).toContain("Private page not found");
    expect(missingMarkup).toContain('href="/"');
    for (const markup of [errorMarkup, missingMarkup]) {
      expect(markup).not.toContain(privateError.message);
      expect(markup).not.toContain(privateError.digest);
      expect(markup).not.toContain("DATABASE_URL");
    }
  });
});
