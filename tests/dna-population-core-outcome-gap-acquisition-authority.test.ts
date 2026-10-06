import { describe, expect, it } from "vitest";

import { createDnaPopulationCoreOutcomeGapAcquisitionAuthority } from "@/lib/dna-population-core-outcome-gap-acquisition-authority";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";

describe("DNA population Core outcome gap acquisition authority", () => {
  it("binds the exact measured gap to a deterministic private acquisition generation", () => {
    const coreIds = [20, 40, 60] as const;
    const gapCoreSetSha256 = dnaOpenLabRawEvidenceSha256({
      domain: "dna-population-core-outcome-api-gap-core-set/v1",
      coreIds,
    });
    const authority = createDnaPopulationCoreOutcomeGapAcquisitionAuthority({
      evaluatedAt: "2026-10-06T00:30:00.000Z",
      apiGapCoreIds: coreIds,
      expectedApiGapCoreCount: 3,
      expectedApiGapCoreSetSha256: gapCoreSetSha256,
      expectedMissingMembershipSetSha256: "a".repeat(64),
    });

    expect(authority).toMatchObject({
      apiGapCoreCount: 3,
      apiGapCoreSetSha256: gapCoreSetSha256,
      missingMembershipSetSha256: "a".repeat(64),
      coreIds,
    });
    expect(authority.generationId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    expect(authority.coreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when the measured gap identity drifts", () => {
    expect(() =>
      createDnaPopulationCoreOutcomeGapAcquisitionAuthority({
        evaluatedAt: "2026-10-06T00:30:00.000Z",
        apiGapCoreIds: [20, 40],
        expectedApiGapCoreCount: 2,
        expectedApiGapCoreSetSha256: "b".repeat(64),
        expectedMissingMembershipSetSha256: "a".repeat(64),
      }),
    ).toThrow("does not match the accepted exact-gap measurement");
  });

  it("rejects unsorted or duplicate Core identities", () => {
    const digest = dnaOpenLabRawEvidenceSha256({
      domain: "dna-population-core-outcome-api-gap-core-set/v1",
      coreIds: [20, 40],
    });
    expect(() =>
      createDnaPopulationCoreOutcomeGapAcquisitionAuthority({
        evaluatedAt: "2026-10-06T00:30:00.000Z",
        apiGapCoreIds: [40, 20],
        expectedApiGapCoreCount: 2,
        expectedApiGapCoreSetSha256: digest,
        expectedMissingMembershipSetSha256: "a".repeat(64),
      }),
    ).toThrow("strictly increasing");
  });
});
