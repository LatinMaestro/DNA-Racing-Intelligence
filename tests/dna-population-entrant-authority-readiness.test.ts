import { describe, expect, it, vi } from "vitest";

import {
  createDnaPopulationEntrantAuthorityReadinessInspector,
  DnaPopulationEntrantAuthorityReadinessError,
} from "@/lib/dna-population-entrant-authority-readiness";

const HEAD = "a".repeat(40);
const OWNER = "private-owner";
const HASH = "b".repeat(64);

function authoritySource(events: string[] = []) {
  return Object.freeze({
    load: vi.fn(async () => {
      events.push("authority");
      return Object.freeze({
        exactCodeHeadSha: HEAD,
        plan: {} as never,
        raceDocuments: Object.freeze([]),
        authority: Object.freeze({
          version: 1 as const,
          generationId: HASH,
          unresolvedRaceCount: 17,
          unresolvedRaceSetSha256: HASH,
        }),
      });
    }),
  });
}

function capacityGate(events: string[] = []) {
  return Object.freeze({
    assertFreshCurrentCapacity: vi.fn(async () => {
      events.push("capacity");
      return Object.freeze({
        version: 1 as const,
        generationId: HASH,
        unresolvedRaceCount: 17,
        unresolvedRaceSetSha256: HASH,
        observedAt: "2026-09-26T13:20:00.000Z",
        capacityAllowed: true as const,
        paidUsageAllowed: false as const,
      });
    }),
  });
}

describe("population entrant commissioning readiness", () => {
  it("derives exact authority then proves fresh zero-cost capacity without persistence semantics", async () => {
    const events: string[] = [];
    const source = authoritySource(events);
    const gate = capacityGate(events);
    const inspector = createDnaPopulationEntrantAuthorityReadinessInspector({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      authoritySource: source,
      capacityGate: gate,
    });

    const receipt = await inspector.inspect();

    expect(events).toEqual(["authority", "capacity"]);
    expect(receipt).toEqual({
      status: "ready",
      exactCodeHeadSha: HEAD,
      unresolvedRaceCount: 17,
      unresolvedRaceSetSha256: HASH,
      capacityObservedAt: "2026-09-26T13:20:00.000Z",
      previewOnly: true,
      dnaEntrantHydrationPerformed: false,
      checkpointInitializationPerformed: false,
      entrantChunkPersistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("fails closed when capacity approval disagrees with live authority", async () => {
    const source = authoritySource();
    const gate = capacityGate();
    gate.assertFreshCurrentCapacity.mockResolvedValueOnce(
      Object.freeze({
        version: 1 as const,
        generationId: HASH,
        unresolvedRaceCount: 18,
        unresolvedRaceSetSha256: HASH,
        observedAt: "2026-09-26T13:20:00.000Z",
        capacityAllowed: true as const,
        paidUsageAllowed: false as const,
      }),
    );
    const inspector = createDnaPopulationEntrantAuthorityReadinessInspector({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      authoritySource: source,
      capacityGate: gate,
    });

    await expect(inspector.inspect()).rejects.toBeInstanceOf(
      DnaPopulationEntrantAuthorityReadinessError,
    );
  });

  it("sanitizes underlying authority failures", async () => {
    const inspector = createDnaPopulationEntrantAuthorityReadinessInspector({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      authoritySource: Object.freeze({
        load: vi.fn(async () => {
          throw new Error("postgres://private-secret");
        }),
      }),
      capacityGate: capacityGate(),
    });

    const error = await inspector.inspect().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DnaPopulationEntrantAuthorityReadinessError);
    expect(String(error)).not.toContain("private-secret");
  });
});
