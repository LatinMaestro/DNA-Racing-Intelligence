import { describe, expect, it, vi } from "vitest";

import { createActiveCoreHistoryDurableRaceAuthority } from "@/lib/active-core-history-durable-race-authority";
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
  return Object.freeze({ canonical, rawEvidenceSha256: digest });
}

const DEFAULT_EVIDENCE = Object.freeze([
  race("race-1", "c".repeat(64)),
  race("race-2", "d".repeat(64)),
]);

function audit(
  evidence = DEFAULT_EVIDENCE,
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
  it("caches one exact snapshot", async () => {
    const auditSource = source(audit());
    const authority = createActiveCoreHistoryDurableRaceAuthority({
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
  });

  it("fails closed on invalid evidence", async () => {
    const authority = createActiveCoreHistoryDurableRaceAuthority({
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

    const staleAudit = Object.freeze({
      ...audit(),
      exactCodeHeadSha: "f".repeat(40),
    });
    const staleAuthority = createActiveCoreHistoryDurableRaceAuthority({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      source: source(staleAudit),
    });
    await expect(
      staleAuthority.readRaceDocuments(OWNER, ["race-1"]),
    ).rejects.toThrow("exact durable Race snapshot is unavailable");

    const duplicateEvidence = Object.freeze([
      race("race-1", "c".repeat(64)),
      race("race-1", "e".repeat(64)),
    ]);
    const ambiguous = createActiveCoreHistoryDurableRaceAuthority({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      source: source(audit(duplicateEvidence)),
    });
    await expect(
      ambiguous.readRaceDocuments(OWNER, ["race-1"]),
    ).rejects.toThrow("durable Race snapshot is ambiguous");
  });
});
