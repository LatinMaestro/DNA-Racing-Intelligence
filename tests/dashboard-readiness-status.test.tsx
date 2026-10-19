import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardReadinessStatus } from "@/components/dashboard-readiness-status";

describe("Dashboard readiness status", () => {
  it("renders a fail-closed unavailable state without an activation action", () => {
    const markup = renderToStaticMarkup(
      <DashboardReadinessStatus
        state={{
          connectionStatus: "assessment_read_failed",
          assessmentId: null,
          assessmentVersion: null,
          assessmentSnapshotSha256: null,
          exactHeadSha: null,
          publishedAt: null,
          evidenceCurrentThrough: null,
          evidenceFreshness: null,
          moduleBoundarySummary: null,
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

  it("renders a fail-closed integrity state without gate counts", () => {
    const markup = renderToStaticMarkup(
      <DashboardReadinessStatus
        state={{
          connectionStatus: "assessment_integrity_failed",
          assessmentId: null,
          assessmentVersion: null,
          assessmentSnapshotSha256: null,
          exactHeadSha: null,
          publishedAt: null,
          evidenceCurrentThrough: null,
          evidenceFreshness: null,
          moduleBoundarySummary: null,
          readiness: null,
        }}
      />,
    );

    expect(markup).toContain("Assessment integrity failed");
    expect(markup).toContain("All readiness gates remain withheld");
    expect(markup).toContain("Not available");
    expect(markup).not.toContain("private provider detail");
    expect(markup).not.toContain("Activate");
  });

  it("renders the accepted assessment publication identity", () => {
    const markup = renderToStaticMarkup(
      <DashboardReadinessStatus
        state={{
          connectionStatus: "assessment_connected",
          assessmentId: "readiness-accepted-1",
          assessmentVersion: "readiness-v3",
          assessmentSnapshotSha256: "b".repeat(64),
          exactHeadSha: "a".repeat(40),
          publishedAt: "2026-10-19T01:30:00.000Z",
          evidenceCurrentThrough: "2026-10-19T01:00:00.000Z",
          evidenceFreshness: "current",
          moduleBoundarySummary: {
            total: 23,
            notVerified: 17,
            fixtureVerified: 4,
            connectedVerified: 1,
            failed: 1,
          },
          readiness: null,
        }}
      />,
    );

    expect(markup).toContain("readiness-accepted-1 · readiness-v3");
    expect(markup).toContain("2026-10-19 01:30:00 UTC");
    expect(markup).toContain(`Accepted snapshot SHA-256: ${"b".repeat(64)}`);
    expect(markup).toContain(
      "1 connected · 4 fixture · 17 unverified · 1 failed",
    );
    expect(markup).toContain("23 boundaries tracked");
    expect(markup).toContain("Fixture verification");
  });
});
