import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DashboardPage from "@/app/(private)/page";

describe("private dashboard operating status", () => {
  it("reflects active private hosting without overstating data readiness", () => {
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain("Private owner workspace");
    expect(markup).toContain("Private hosting is active");
    expect(markup).toContain("Automatic Git deployments remain disabled");
    expect(markup).toContain("Awaiting first accepted import");
    expect(markup).toContain("Data current through");
    expect(markup).toContain("Not available");
    expect(markup).not.toContain("Phase 0");
    expect(markup).not.toContain("Disabled pending explicit Gate F approval");
  });
});
