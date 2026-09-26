import { describe, expect, it } from "vitest";

import {
  createDnaPopulationEntrantAuthorityReadinessHandoff,
  DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_MAXIMUM_AGE_MILLISECONDS,
  DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION,
  DnaPopulationEntrantAuthorityReadinessHandoffError,
  validateDnaPopulationEntrantAuthorityReadinessHandoff,
} from "@/lib/dna-population-entrant-authority-readiness-handoff";
import { DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS } from "@/lib/dna-open-lab-provider-capacity-preflight";
import type { DnaPopulationEntrantAuthorityReadinessReceipt } from "@/lib/dna-population-entrant-authority-readiness";

const HEAD = "a".repeat(40);
const HASH = "b".repeat(64);
const OBSERVED_AT = "2026-09-26T13:20:00.000Z";

function receipt(
  overrides: Partial<DnaPopulationEntrantAuthorityReadinessReceipt> = {},
): DnaPopulationEntrantAuthorityReadinessReceipt {
  return Object.freeze({
    status: "ready",
    exactCodeHeadSha: HEAD,
    unresolvedRaceCount: 17,
    unresolvedRaceSetSha256: HASH,
    capacityObservedAt: OBSERVED_AT,
    previewOnly: true,
    dnaEntrantHydrationPerformed: false,
    checkpointInitializationPerformed: false,
    entrantChunkPersistentWritePerformed: false,
    providerWritePerformed: false,
    paidUsageAllowed: false,
    ...overrides,
  });
}

describe("population entrant readiness handoff", () => {
  it("binds the exact sanitized readiness receipt and accepts it only within the existing five-minute freshness window", () => {
    expect(
      DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_MAXIMUM_AGE_MILLISECONDS,
    ).toBe(DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS);

    const handoff =
      createDnaPopulationEntrantAuthorityReadinessHandoff(receipt());

    expect(handoff).toMatchObject({
      version: DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION,
      exactCodeHeadSha: HEAD,
      expectedUnresolvedRaceCount: 17,
      expectedUnresolvedRaceSetSha256: HASH,
      readinessCapacityObservedAt: OBSERVED_AT,
    });
    expect(handoff.readinessReceiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      validateDnaPopulationEntrantAuthorityReadinessHandoff({
        handoff,
        checkedAt: "2026-09-26T13:25:00.000Z",
      }),
    ).toEqual(handoff);
  });

  it("rejects handoff field tampering even when the replacement field is otherwise well formed", () => {
    const handoff =
      createDnaPopulationEntrantAuthorityReadinessHandoff(receipt());

    expect(() =>
      validateDnaPopulationEntrantAuthorityReadinessHandoff({
        handoff: {
          ...handoff,
          expectedUnresolvedRaceCount: 18,
        },
        checkedAt: "2026-09-26T13:21:00.000Z",
      }),
    ).toThrow(DnaPopulationEntrantAuthorityReadinessHandoffError);

    try {
      validateDnaPopulationEntrantAuthorityReadinessHandoff({
        handoff: {
          ...handoff,
          expectedUnresolvedRaceSetSha256: "c".repeat(64),
        },
        checkedAt: "2026-09-26T13:21:00.000Z",
      });
    } catch (error) {
      expect(error).toMatchObject({ diagnostic: "invalid" });
    }
  });

  it("rejects stale or future-dated readiness evidence", () => {
    const handoff =
      createDnaPopulationEntrantAuthorityReadinessHandoff(receipt());

    for (const checkedAt of [
      "2026-09-26T13:25:00.001Z",
      "2026-09-26T13:19:59.999Z",
    ]) {
      try {
        validateDnaPopulationEntrantAuthorityReadinessHandoff({
          handoff,
          checkedAt,
        });
        throw new Error("expected stale readiness handoff failure");
      } catch (error) {
        expect(error).toMatchObject({ diagnostic: "stale" });
      }
    }
  });

  it("rejects any receipt that does not preserve the read-only zero-cost readiness semantics", () => {
    expect(() =>
      createDnaPopulationEntrantAuthorityReadinessHandoff(
        receipt({
          checkpointInitializationPerformed: true,
        } as unknown as Partial<DnaPopulationEntrantAuthorityReadinessReceipt>),
      ),
    ).toThrow(DnaPopulationEntrantAuthorityReadinessHandoffError);
  });
});
