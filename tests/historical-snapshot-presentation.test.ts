import { describe, expect, it } from "vitest";

import {
  auditHistoricalSnapshotPresentation,
  type HistoricalSnapshotPresentationInput,
} from "../domain/historical-snapshot-presentation";

function input(
  overrides: Partial<HistoricalSnapshotPresentationInput> = {},
): HistoricalSnapshotPresentationInput {
  return {
    auditId: "audit-1",
    surface: "core_profile",
    visibleText: [
      "Historical snapshot",
      "Data current through 21 July 2026",
      "Last imported 21 July 2026",
      "Current import",
      "This page is not live data.",
    ],
    ...overrides,
  };
}

describe("historical snapshot presentation audit", () => {
  it("accepts complete historical disclosures and an explicit not-live warning", () => {
    expect(auditHistoricalSnapshotPresentation(input())).toEqual({
      auditId: "audit-1",
      surface: "core_profile",
      compliant: true,
      issues: [],
      liveStateClaimDetected: false,
      requiredDisclosureCount: 4,
      historicalSnapshotRequired: true,
      authoritativeLiveIntegrationPresent: false,
      productionApprovalGranted: false,
    });
  });

  it("requires every core historical disclosure", () => {
    const result = auditHistoricalSnapshotPresentation(
      input({ visibleText: ["Imported core profile"] }),
    );
    expect(result.compliant).toBe(false);
    expect(result.issues).toEqual([
      "missing_historical_snapshot_label",
      "missing_data_current_through_label",
      "missing_last_imported_label",
      "missing_freshness_label",
    ]);
  });

  it("rejects live, real-time and up-to-date imported-state claims", () => {
    for (const claim of [
      "Live opponents shown here.",
      "Real-time arena listings.",
      "This field is up-to-date.",
    ]) {
      const result = auditHistoricalSnapshotPresentation(
        input({ visibleText: [...input().visibleText, claim] }),
      );
      expect(result.issues).toContain("live_state_claim");
      expect(result.liveStateClaimDetected).toBe(true);
    }
  });

  it("allows clear negative disclosures about unavailable live state", () => {
    const result = auditHistoricalSnapshotPresentation(
      input({
        visibleText: [
          ...input().visibleText,
          "The website is not connected to live opponents or real-time data.",
        ],
      }),
    );
    expect(result.issues).not.toContain("live_state_claim");
  });

  it("requires Open Race manual and historical sources to be distinguished", () => {
    const result = auditHistoricalSnapshotPresentation(
      input({ surface: "open_race" }),
    );
    expect(result.issues).toContain("missing_open_race_source_distinction");

    const compliant = auditHistoricalSnapshotPresentation(
      input({
        surface: "open_race",
        visibleText: [
          ...input().visibleText,
          "Manually entered current field",
          "Imported historical evidence",
        ],
      }),
    );
    expect(compliant.compliant).toBe(true);
    expect(compliant.requiredDisclosureCount).toBe(5);
  });

  it("rejects empty visible text and invalid runtime surface values", () => {
    expect(() =>
      auditHistoricalSnapshotPresentation(input({ visibleText: [] })),
    ).toThrow("requires visible text");
    expect(() =>
      auditHistoricalSnapshotPresentation({
        ...input(),
        surface: "dashboard",
      } as unknown as HistoricalSnapshotPresentationInput),
    ).toThrow("surface is invalid");
  });
});
