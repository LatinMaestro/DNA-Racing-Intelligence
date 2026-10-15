import { describe, expect, it, vi } from "vitest";
import type {
  MaidenAllocationBracketInput,
  MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";
import { decodeMaidenAllocationEvidenceSnapshot } from "@/lib/maiden-allocation-evidence-snapshot";
import {
  materializeAcceptedMaidenEvidence,
  type MaidenAcceptedGenerationSource,
  type MaidenEvidenceMaterializationBoundary,
  type MaidenEvidencePublicationCandidate,
  type MaidenEvidencePublicationOutcome,
} from "@/lib/maiden-accepted-evidence-materializer";

const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const sourceSha = "a".repeat(64);
const now = new Date("2026-10-15T12:00:00.000Z");

const versions = {
  configurationVersion: "synthetic-config-v1",
  candidateSnapshotVersion: "synthetic-snapshot-v1",
  projectionVersion: "synthetic-approved-method-v1",
};
const bracket: MaidenAllocationBracketInput = {
  tournamentId: "synthetic-maiden",
  tournamentLabel: "Synthetic Maiden",
  bracketId: "synthetic-horse-bracket",
  bracketLabel: "Synthetic Horse",
  mode: "horse",
  ...versions,
  reviewCapacity: 1,
  availability: "upcoming",
  ruleStatus: "confirmed",
};
const candidate: MaidenAllocationCandidateInput = {
  candidateId: "synthetic-candidate",
  coreId: "synthetic-core",
  tournamentId: bracket.tournamentId,
  bracketId: bracket.bracketId,
  mode: bracket.mode,
  ...versions,
  projectionBasis: "time_led_chronological",
  projectedValueBasisPoints: 8500,
  suitability: "review_candidate",
  lifecycleState: "eligible",
  evidenceConfidence: "moderate",
  timeEvidence: "competitive",
  historicalStarSupport: "supports",
  crossModeEvidenceComplete: true,
  dataCurrentThrough: "2026-10-14T00:00:00.000Z",
  lastImported: "2026-10-14T02:00:00.000Z",
  freshness: "ageing",
};
const source: MaidenAcceptedGenerationSource = {
  databaseOwnerId: owner,
  sourceEvidenceSha256: sourceSha,
  coverage: {
    state: "accepted",
    generationIntegrityVerified: true,
    ownerStrategyCorrectionsVerified: true,
    crossModeGenerationVerified: true,
    expectedOwnerMaidenEligibleCores: 1,
    verifiedOwnerMaidenEligibleCores: 1,
    expectedBrackets: 1,
    verifiedBrackets: 1,
    unsupportedSourceRows: 0,
  },
  evidence: {
    brackets: [bracket],
    candidates: [candidate],
    lastImportedAt: "2026-10-14T02:00:00.000Z",
  },
};

function harness(
  overrides: Readonly<{
    source?: MaidenAcceptedGenerationSource | null;
    acceptedIdentity?: string | null;
    publication?: "published" | "unchanged" | "source_changed" | "invalid";
  }> = {},
) {
  const loadCanonicalSource = vi.fn(async () =>
    overrides.source === undefined ? source : overrides.source,
  );
  const readAcceptedSourceIdentity = vi.fn(async () =>
    overrides.acceptedIdentity === undefined
      ? sourceSha
      : overrides.acceptedIdentity,
  );
  const publishCandidate = vi.fn(
    async (_candidate: MaidenEvidencePublicationCandidate) =>
      (overrides.publication ?? "published") as MaidenEvidencePublicationOutcome,
  );
  const boundary = {
    loadCanonicalSource,
    readAcceptedSourceIdentity,
    publishCandidate,
  } as MaidenEvidenceMaterializationBoundary;
  return {
    input: { databaseOwnerId: owner, boundary, now: () => now },
    loadCanonicalSource,
    readAcceptedSourceIdentity,
    publishCandidate,
  };
}

describe("accepted Maiden compact evidence materialization boundary", () => {
  it("validates the complete source, encodes without retuning, and publishes once", async () => {
    const h = harness();
    await expect(materializeAcceptedMaidenEvidence(h.input)).resolves.toEqual({
      status: "published",
    });
    expect(h.loadCanonicalSource).toHaveBeenCalledOnce();
    expect(h.readAcceptedSourceIdentity).toHaveBeenCalledWith(owner);
    expect(h.publishCandidate).toHaveBeenCalledOnce();

    const publication = h.publishCandidate.mock.calls[0]?.[0];
    expect(publication).toMatchObject({
      databaseOwnerId: owner,
      expectedSourceEvidenceSha256: sourceSha,
      materializedAt: now.toISOString(),
    });
    const evidence = decodeMaidenAllocationEvidenceSnapshot({
      json: publication!.snapshotJson,
      sha256: publication!.snapshotSha256,
      databaseOwnerId: owner,
      sourceEvidenceSha256: sourceSha,
      now,
    });
    expect(evidence.candidates[0]).toMatchObject({
      projectedValueBasisPoints: 8500,
      projectionBasis: "time_led_chronological",
      historicalStarSupport: "supports",
      crossModeEvidenceComplete: true,
    });
  });

  it.each(["unchanged", "source_changed"] as const)(
    "honours publisher atomic last-good outcome %s",
    async (status) => {
      const h = harness({ publication: status });
      await expect(materializeAcceptedMaidenEvidence(h.input)).resolves.toEqual({
        status,
      });
    },
  );

  it("does not publish without an accepted canonical generation", async () => {
    const h = harness({ source: null });
    await expect(materializeAcceptedMaidenEvidence(h.input)).resolves.toEqual({
      status: "source_unavailable",
    });
    expect(h.readAcceptedSourceIdentity).not.toHaveBeenCalled();
    expect(h.publishCandidate).not.toHaveBeenCalled();
  });

  it.each([
    { state: "unknown" as const },
    { state: "partial" as const },
    { generationIntegrityVerified: false },
    { ownerStrategyCorrectionsVerified: false },
    { crossModeGenerationVerified: false },
    { expectedOwnerMaidenEligibleCores: 2 },
    { verifiedOwnerMaidenEligibleCores: 0 },
    { expectedBrackets: 2 },
    { verifiedBrackets: 2 },
    { unsupportedSourceRows: 1 },
  ])("withholds incomplete or correction-uncertain evidence %#", async (change) => {
    const h = harness({
      source: { ...source, coverage: { ...source.coverage, ...change } },
    });
    await expect(materializeAcceptedMaidenEvidence(h.input)).resolves.toEqual({
      status: "source_incomplete",
    });
    expect(h.readAcceptedSourceIdentity).not.toHaveBeenCalled();
    expect(h.publishCandidate).not.toHaveBeenCalled();
  });

  it("rejects source changes before publication, including missing identity", async () => {
    for (const identity of ["b".repeat(64), null]) {
      const h = harness({ acceptedIdentity: identity });
      await expect(materializeAcceptedMaidenEvidence(h.input)).resolves.toEqual({
        status: "source_changed",
      });
      expect(h.publishCandidate).not.toHaveBeenCalled();
    }
  });

  it("will not replace last-good with a mismatched owner or claimed digest", async () => {
    for (const altered of [
      { ...source, databaseOwnerId: otherOwner },
      { ...source, sourceEvidenceSha256: "not-trusted" },
    ]) {
      const h = harness({ source: altered });
      await expect(materializeAcceptedMaidenEvidence(h.input)).rejects.toThrow(
        "Maiden accepted evidence materialization unavailable.",
      );
      expect(h.publishCandidate).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid bracket versions and over-limit snapshots", async () => {
    const cases = [
      {
        ...source,
        evidence: {
          ...source.evidence,
          candidates: [
            { ...candidate, configurationVersion: "unaccepted-version" },
          ],
        },
      },
      {
        ...source,
        evidence: {
          ...source.evidence,
          brackets: [
            { ...bracket, bracketLabel: "synthetic-oversize".repeat(40000) },
          ],
        },
      },
    ];
    for (const invalid of cases) {
      const h = harness({ source: invalid });
      await expect(materializeAcceptedMaidenEvidence(h.input)).rejects.toThrow(
        "Maiden accepted evidence materialization unavailable.",
      );
      expect(h.publishCandidate).not.toHaveBeenCalled();
    }
  });

  it("sanitizes read, clock and publisher failures without leaking source", async () => {
    const load = harness();
    load.loadCanonicalSource.mockRejectedValueOnce(
      Error("private source and owner details"),
    );
    await expect(materializeAcceptedMaidenEvidence(load.input)).rejects.toThrow(
      "Maiden accepted evidence materialization unavailable.",
    );
    expect(load.publishCandidate).not.toHaveBeenCalled();

    const current = harness();
    current.readAcceptedSourceIdentity.mockRejectedValueOnce(
      Error("private current source"),
    );
    await expect(materializeAcceptedMaidenEvidence(current.input)).rejects.toThrow(
      "Maiden accepted evidence materialization unavailable.",
    );
    expect(current.publishCandidate).not.toHaveBeenCalled();

    const published = harness();
    published.publishCandidate.mockRejectedValueOnce(
      Error("private storage details"),
    );
    await expect(
      materializeAcceptedMaidenEvidence(published.input),
    ).rejects.toThrow("Maiden accepted evidence materialization unavailable.");

    const malformed = harness({ publication: "invalid" });
    await expect(materializeAcceptedMaidenEvidence(malformed.input)).rejects.toThrow(
      "Maiden accepted evidence materialization unavailable.",
    );
    const clock = harness();
    await expect(
      materializeAcceptedMaidenEvidence({
        ...clock.input,
        now: () => new Date("invalid"),
      }),
    ).rejects.toThrow("Maiden accepted evidence materialization unavailable.");
    expect(clock.loadCanonicalSource).not.toHaveBeenCalled();
  });

  it("rejects incomplete boundary or owner before source access", async () => {
    const h = harness();
    await expect(
      materializeAcceptedMaidenEvidence({
        ...h.input,
        databaseOwnerId: "invalid",
      }),
    ).rejects.toThrow("Maiden accepted evidence materialization unavailable.");
    await expect(
      materializeAcceptedMaidenEvidence({
        ...h.input,
        boundary: {
          ...h.input.boundary,
          publishCandidate: null as unknown as MaidenEvidenceMaterializationBoundary["publishCandidate"],
        },
      }),
    ).rejects.toThrow("Maiden accepted evidence materialization unavailable.");
    expect(h.loadCanonicalSource).not.toHaveBeenCalled();
  });
});
