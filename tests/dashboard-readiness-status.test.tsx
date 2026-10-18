import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardReadinessStatus } from "@/components/dashboard-readiness-status";

describe("Dashboard readiness status", () => {
  it("renders a fail-closed unavailable state without an activation action", () => {
    const markup = renderToStaticMarkup(
      <DashboardReadinessStatus
        state={{
          connectionStatus: "assessment_read_failed",
          exactHeadSha: null,
          evidenceCurrentThrough: null,
          evidenceFreshness: null,
          readiness: null,
        }}
      />,
    );

    expect(markup).toContain("Commissioning readiness");
    expect(markup).toContain("Assessment read failed");
    expect(markup).toContain("No cached, stale or inferred replacement");
    expect(markup).toContain('href="/readiness"');
    expect(markup).not.toContain("private provider detail");
    expect(markup).not.toContain("Activate");
  });
});
