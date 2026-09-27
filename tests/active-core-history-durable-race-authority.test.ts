import { describe, expect, it, vi } from "vitest";

import { createActiveCoreHistoryDurableRaceAuthority as createRaceAuthority } from "@/lib/active-core-history-durable-race-authority";
import type {
  DnaPopulationEntrantAuthorityLiveAudit,
  DnaPopulationEntrantAuthorityLiveAuditSource,
} from "@/lib/dna-population-entrant-authority-cohort-command";

const OWNER = "private-owner";
const HEAD = "a".repeat(40);
const GENERATION = "b".repeat(64);

function race(sourceRaceId: string, digest: string) {
  const canonical = Object.freeze({
    sourceType: "race_document" as const,
    sourceRaceId,
    mode: "bike" as const,
    distanceMetres: 1_200,
    gateCount: 12,
    entrantCoreIds: ["101"],
    startAt: "2026-09-16T00:00:00.000Z",
  });
  return Object.freeze({
    canonical,
    rawEvidenceSha256: digest,
  });
}

function audit(
  evidence = [
    race("race-1", "c".repeat(64)),
    race("race-2", "d".repeat(64)),
  ],
): DnaPopulationEntrantAuthorityLiveAudit {
  return Object.freeze({
    exactCodeHeadSha: HEAD,
    plan: {} as never,
    raceDocuments: Object.freeze(evidence.map((value) => value.canonical)),
    raceDocumentEvidence: Object.freeze(evidence),
    authority: Object.freeze({
      version: 1 as const,
      generationId: GENERATION,
      unresolvedRaceCount: 2,
      unresolvedRaceSetSha256: GENERATION,
    }),
  });
}

function source(value: DnaPopulationEntrantAuthorityLiveAudit) {
  return Object.freeze({
    load: vi.fn(async () => value),
  }) satisfies DnaPopulationEntrantAuthorityLiveAuditSource;
}

describe("active Core history durable Race authority", () => {
  it(
    "loads one exact-main snapshot, preserves requested order and caches it",
    async () => {
      const auditSource = source(audit());
      const authority = createRaceAuthority({
        ownerId: OWNER,
        exactCodeHeadSha: HEAD,
        source: auditSource,
      });

      await expect(
        authority.readRaceDocuments(OWNER, ["race-2", "race-1"]),
      ).resolves.toEqual([
        expect.objectContaining({
          rawEvidenceSha256: "d".repeat(64),
          canonical: expect.objectContaining({ sourceRaceId: "race-2" }),
        }),
        expect.objectContaining({
          rawEvidenceSha256: "c".repeat(64),
          canonical: expect.objectContaining({ sourceRaceId: "race-1" }),
        }),
      ]);
      await authority.readRaceDocuments(OWNER, ["race-1"]);
      expect(auditSource.load).toHaveBeenCalledTimes(1);
      expect(auditSource.load).toHaveBeenCalledWith({
        ownerId: OWNER,
        exactCodeHeadSha: HEAD,
      });
    },
  );

  it(
    "fails closed on missing, duplicate, cross-owner or stale evidence",
    async () => {
      const authority = createRaceAuthority({
        ownerId: OWNER,
        exactCodeHeadSha: HEAD,
        source: source(audit()),
      });
      await expect(
        authority.readRaceDocuments(OWNER, ["race-missing"]),
      ).rejects.toThrow("requested Race evidence is unavailable");
      await expect(
        authority.readRaceDocuments(OWNER, ["race-1", "race-1"]),
      ).rejects.toThrow("duplicate identities");
      await expect(
        authority.readRaceDocuments("other-owner", ["race-1"]),
      ).rejects.toThrow("owner scope changed");

      const stale = source(
        Object.freeze({ ...audit(), exactCodeHeadSha: "f".repeat(40) }),
      );
      const staleAuthority = createRaceAuthority({
        ownerId: OWNER,
        exactCodeHeadSha: HEAD,
        source: stale,
      });
      await expect(
        staleAuthority.readRaceDocuments(OWNER, ["race-1"]),
      ).rejects.toThrow("exact durable Race snapshot is unavailable");

      const duplicated = race("race-1", "e".repeat(64));
      const ambiguous = createRaceAuthority({
        ownerId: OWNER,
        exactCodeHeadSha: HEAD,
        source: source(audit([race("race-1", "c".repeat(64)), duplicated])),
      });
      await expect(
        ambiguous.readRaceDocuments(OWNER, ["race-1"]),
      ).rejects.toThrow("durable Race snapshot is ambiguous");
    },
  );
});
