import { describe, expect, it } from "vitest";
import {
  projectCoreSourceCoverage,
  type CoreCoverageDetails,
} from "@/domain/core-source-coverage";

function details(
  coreId: string,
  coreClass: CoreCoverageDetails["coreClass"],
  parentCoreIds: readonly string[] = [],
): CoreCoverageDetails {
  return { coreId, coreClass, parentCoreIds };
}

describe("Core Details, race, Vault and Arena coverage projection", () => {
  const coreDetails = [
    details("genesis-a", "Genesis"),
    details("genesis-b", "Genesis"),
    details("owned-child", "Morphed", ["genesis-a", "genesis-b"]),
    details("arena-no-history", "Genesis"),
  ] as const;

  it("joins a confirmed owned core to complete details, race and lineage evidence", () => {
    const result = projectCoreSourceCoverage({
      coreDetails,
      ownedCoreIds: ["owned-child"],
      arenaCoreIds: [],
      racedCoreIds: ["owned-child"],
    });

    expect(result.cores.find(({ coreId }) => coreId === "owned-child")).toEqual(
      {
        coreId: "owned-child",
        contexts: ["current_vault", "race_history"],
        coreDetailsStatus: "available",
        raceHistoryStatus: "available",
        lineageStatus: "available",
        analyticalProfileStatus: "ready",
        familyRestrictionStatus: "checkable",
      },
    );
  });

  it("treats a parentless Genesis record as a complete founder", () => {
    const result = projectCoreSourceCoverage({
      coreDetails,
      ownedCoreIds: [],
      arenaCoreIds: [],
      racedCoreIds: ["genesis-a"],
    });

    expect(
      result.cores.find(({ coreId }) => coreId === "genesis-a"),
    ).toMatchObject({
      lineageStatus: "founder",
      analyticalProfileStatus: "ready",
      familyRestrictionStatus: "checkable",
    });
  });

  it("keeps raced IDs without Core Details as performance-only evidence", () => {
    const result = projectCoreSourceCoverage({
      coreDetails,
      ownedCoreIds: [],
      arenaCoreIds: [],
      racedCoreIds: ["race-only"],
    });

    expect(result.cores.find(({ coreId }) => coreId === "race-only")).toEqual({
      coreId: "race-only",
      contexts: ["race_history"],
      coreDetailsStatus: "missing",
      raceHistoryStatus: "available",
      lineageStatus: "missing_core_details",
      analyticalProfileStatus: "performance_only",
      familyRestrictionStatus: "review_required",
    });
  });

  it("shows an Arena core with details but no races as no imported history", () => {
    const result = projectCoreSourceCoverage({
      coreDetails,
      ownedCoreIds: [],
      arenaCoreIds: ["arena-no-history"],
      racedCoreIds: [],
    });

    expect(
      result.cores.find(({ coreId }) => coreId === "arena-no-history"),
    ).toMatchObject({
      contexts: ["current_arena"],
      coreDetailsStatus: "available",
      raceHistoryStatus: "no_imported_racing_history",
      lineageStatus: "founder",
      analyticalProfileStatus: "no_imported_racing_history",
      familyRestrictionStatus: "checkable",
    });
  });

  it("keeps an Arena ID with neither details nor races as source identity only", () => {
    const result = projectCoreSourceCoverage({
      coreDetails,
      ownedCoreIds: [],
      arenaCoreIds: ["arena-identity-only"],
      racedCoreIds: [],
    });

    expect(
      result.cores.find(({ coreId }) => coreId === "arena-identity-only"),
    ).toMatchObject({
      contexts: ["current_arena"],
      coreDetailsStatus: "missing",
      raceHistoryStatus: "no_imported_racing_history",
      analyticalProfileStatus: "source_identity_only",
      familyRestrictionStatus: "review_required",
    });
  });

  it("blocks family checks for incomplete or inconsistent parentage", () => {
    const result = projectCoreSourceCoverage({
      coreDetails: [
        details("known-parent", "Genesis"),
        details("one-parent-child", "Morphed", ["known-parent"]),
        details("missing-parent-child", "Freak", [
          "known-parent",
          "missing-parent",
        ]),
        details("invalid-genesis", "Genesis", ["known-parent"]),
      ],
      ownedCoreIds: [],
      arenaCoreIds: [],
      racedCoreIds: [
        "one-parent-child",
        "missing-parent-child",
        "invalid-genesis",
      ],
    });

    for (const coreId of [
      "one-parent-child",
      "missing-parent-child",
      "invalid-genesis",
    ]) {
      expect(result.cores.find((core) => core.coreId === coreId)).toMatchObject(
        {
          lineageStatus: "incomplete_or_inconsistent",
          familyRestrictionStatus: "review_required",
        },
      );
    }
  });

  it("is deterministic and reports explicit aggregate coverage counts", () => {
    const input = {
      coreDetails,
      ownedCoreIds: ["owned-child"],
      arenaCoreIds: ["arena-no-history", "arena-identity-only"],
      racedCoreIds: ["owned-child", "race-only"],
    } as const;
    const expected = projectCoreSourceCoverage(input);
    const reordered = projectCoreSourceCoverage({
      coreDetails: [...input.coreDetails].reverse(),
      ownedCoreIds: [...input.ownedCoreIds].reverse(),
      arenaCoreIds: [...input.arenaCoreIds].reverse(),
      racedCoreIds: [...input.racedCoreIds].reverse(),
    });

    expect(reordered).toEqual(expected);
    expect(expected.counts).toEqual({
      total: 6,
      ready: 1,
      performanceOnly: 1,
      noImportedRacingHistory: 3,
      sourceIdentityOnly: 1,
      familyReviewRequired: 2,
    });
  });

  it("rejects duplicate IDs and blank parent evidence", () => {
    expect(() =>
      projectCoreSourceCoverage({
        coreDetails: [
          details("duplicate", "Genesis"),
          details("duplicate", "Genesis"),
        ],
        ownedCoreIds: [],
        arenaCoreIds: [],
        racedCoreIds: [],
      }),
    ).toThrow("Core Details coreId must be unique");
    expect(() =>
      projectCoreSourceCoverage({
        coreDetails: [details("child", "Morphed", ["parent", ""])],
        ownedCoreIds: [],
        arenaCoreIds: [],
        racedCoreIds: ["child"],
      }),
    ).toThrow("parentCoreId is required");
  });
});
