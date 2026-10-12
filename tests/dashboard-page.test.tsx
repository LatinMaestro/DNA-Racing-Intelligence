import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DashboardPage from "@/app/(private)/page";

describe("private dashboard operating status", () => {
  it("reflects private hosting and the owner-maintained Vault authority", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());

    expect(markup).toContain("Private owner workspace");
    expect(markup).toContain("Private hosting is active");
    expect(markup).toContain("Automatic Git deployments remain disabled");
    expect(markup).toContain("My Vault");
    expect(markup).toContain("Owner-maintained current ownership");
    expect(markup).toContain("Owner setup pending");
    expect(markup).toContain(
      "not inferred from historical races or a Vault CSV",
    );
    expect(markup).toContain("Core snapshot");
    expect(markup).toContain("Race snapshot");
    expect(markup).toContain("Arena snapshot");
    expect(markup).not.toContain("Vault snapshot");
    expect(markup.match(/Freshness unknown here/g)).toHaveLength(3);
    expect(
      markup.match(/Dashboard timestamp receipt not connected/g),
    ).toHaveLength(3);
    expect(markup).toContain(
      "Browse your Vault and linked historical evidence",
    );
    expect(markup).toContain('href="/vault"');
    expect(markup).toContain('href="/core-intelligence?evidence=normal"');
    expect(markup).toContain("Explore Core performance");
    expect(markup).toContain('href="/search-core"');
    expect(markup).toContain("Search race history");
    expect(markup).toContain('href="/breeding"');
    expect(markup).toContain("Review Arena-linked breeding");
    expect(markup).not.toContain("These cards are unverified");
    expect(markup).not.toContain("Awaiting first accepted import");
    expect(markup).not.toContain("No accepted import is connected yet");
    expect(markup).toContain("Data current through");
    expect(markup).toContain("Not available");
    expect(markup).not.toContain("Phase 0");
    expect(markup).not.toContain("Disabled pending explicit Gate F approval");
  });
});
