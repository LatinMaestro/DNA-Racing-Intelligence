import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DashboardReadinessStatus } from "@/components/dashboard-readiness-status";
import { FreshnessStatus } from "@/components/freshness-status";
import { loadDashboardFreshnessPageState } from "@/lib/dashboard-freshness-service";
import { loadDashboardReadinessPageState } from "@/lib/dashboard-readiness-service";

describe("Dashboard readiness status", () => {
  it("replays an empty owner-scoped Preview read without inventing freshness or readiness", async () => {
    const ownerId = "preview-owner";
    const listBatchesByOwner = vi.fn(async () => []);
    const loadLatestAssessmentByOwner = vi.fn(async () => ({
      assessment: null,
      acceptedAssessmentVersion: null,
      publishedAt: null,
      snapshotSha256: null,
    }));
    const [freshnessState, readinessState] = await Promise.all([
      loadDashboardFreshnessPageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: { status: "ready", listBatchesByOwner },
        now: new Date("2026-10-28T00:00:00.000Z"),
      }),
      loadDashboardReadinessPageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: { status: "ready", loadLatestAssessmentByOwner },
        expectedHeadSha: "a".repeat(40),
        now: new Date("2026-10-28T00:00:00.000Z"),
      }),
    ]);

    expect(listBatchesByOwner).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(loadLatestAssessmentByOwner).toHaveBeenCalledExactlyOnceWith(
      ownerId,
    );
    expect(freshnessState.connectionStatus).toBe("read_model_connected");
    expect(freshnessState.workspace.recentBatches).toEqual([]);
    expect(readinessState.connectionStatus).toBe("assessment_unavailable");

    const coreStatus = freshnessState.workspace.sources.find(
      ({ sourceType }) => sourceType === "core_details",
    );
    const markup = renderToStaticMarkup(
      <main>
        <FreshnessStatus
          source="Core"
          connectionStatus={freshnessState.connectionStatus}
          status={coreStatus ?? null}
        />
        <DashboardReadinessStatus state={readinessState} />
      </main>,
    );

    expect(markup).toContain("No active accepted source receipt is available");
    expect(markup).toContain("Freshness unknown here");
    expect(markup).toContain("Assessment unavailable");
    expect(markup).toContain("Not assessed");
    expect(markup).toContain(
      "This summary is read-only. It cannot deploy, enable Production or change provider settings.",
    );
    expect(markup).not.toContain("Assessment connected");
  });

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
