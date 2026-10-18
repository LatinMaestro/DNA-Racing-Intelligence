import { describe, expect, it, vi } from "vitest";
import type { ExactRaceProbabilityContext } from "@/domain/race-probability-baseline";
import {
  readAcceptedOpenRaceScenarioEvidence,
  type OpenRaceAcceptedHistoryReadBoundary,
  type OpenRaceAcceptedHistorySource,
} from "@/lib/open-race-accepted-history-reader";
import { composePersistedOpenRaceCandidateScenario } from "@/lib/open-race-persisted-scenario-service";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

const context: ExactRaceProbabilityContext = {
  mode: "bike",
  distanceMeters: 1400,
  competition: "normal",
  format: "4 gate WTA",
  gateCount: 4,
  element: { status: "unknown", value: null },
};
const sourceIdentity = "a".repeat(64);

function session(): OpenRaceWorkspaceSession {
  return {
    stage: "provisional_selection",
    lock: null,
    observation: null,
    comparison: null,
    field: {
      requestId: "persisted-session",
      capturedAt: "2026-10-17T10:00:00.000Z",
      dataCurrentThrough: "2026-10-16T00:00:00.000Z",
      lastImported: "2026-10-17T09:00:00.000Z",
      mode: "bike",
      distanceMeters: 1400,
      raceFormat: "4 gate WTA",
      probabilityContext: context,
      gateCount: 4,
      availableGates: 3,
      eventStartsAt: "2026-10-17T12:00:00.000Z",
      eventIdentity: { status: "confirmed", eventId: "game-event-101" },
      entryFee: null,
      opponentCoreIds: ["entered-a"],
      freshness: "current",
      status: "ready_for_provisional_selection",
      reviewReasons: [],
      fieldStage: "forming",
      currentRaceStarsAccepted: false,
      historicalSnapshotOnly: true,
      liveGameConnection: false,
      sourceDisclosure: "Synthetic accepted field fixture.",
      restrictions: [],
    },
    eligibility: {
      evaluationId: "eligibility-v1",
      evaluatedAt: "2026-10-17T09:30:00.000Z",
      vaultDataCurrentThrough: "2026-10-16T00:00:00.000Z",
      freshness: "current",
      eligibleCoreIds: ["owned-a"],
      cores: [{ coreId: "owned-a", status: "eligible", reasons: [] }],
      rankingPerformed: false,
      recommendationMade: false,
      currentRaceStarsUsed: false,
      ownershipMutated: false,
    },
    ranking: {
      rankingId: "ranking-v1",
      evaluatedAt: "2026-10-17T11:00:00.000Z",
      dataCurrentThrough: "2026-10-16T00:00:00.000Z",
      freshness: "current",
      status: "provisional",
      provisionalRecommendedCoreId: "owned-a",
      rankedCandidates: [
        {
          rank: 1,
          coreId: "owned-a",
          medianTimeMs: 9_005,
          marginToStrongestOpponentMs: 1_000,
          sampleStatus: "minimally_analytical",
          historicalStarRationale: ["Synthetic historical fixture."],
          starsAffectedRank: false,
        },
      ],
      strongestOpponentCoreId: "entered-a",
      avoidSignal: false,
      reviewReasons: [],
      warnings: [],
      currentRaceStarsUsed: false,
      replacementRecommendationAllowed: false,
      raceEntryAllowed: false,
      finalActionableRecommendationAllowed: false,
    },
    bindings: {
      sessionVersion: "session-v1",
      fieldVersion: "field-v1",
      eligibilityVersion: "eligibility-v1",
      rankingVersion: "ranking-v1",
      raceImportVersion: "race-import-v7",
      vaultSnapshotVersion: "vault-v4",
      historicalAggregateVersion: "aggregate-v5",
      lockVersion: null,
      observationVersion: null,
      comparisonVersion: null,
    },
    mutationAllowed: false,
    liveGameConnection: false,
    gateCPassed: false,
  };
}

function rows(coreId: string, start: number) {
  return Array.from({ length: 10 }, (_, index) => ({
    coreId,
    eventId: `${coreId}-${index}`,
    eventAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    elapsedTimeMilliseconds: start + index,
    context,
  }));
}

function source(
  change: Partial<OpenRaceAcceptedHistorySource> = {},
): OpenRaceAcceptedHistorySource {
  const acceptedRows = [
    ...rows("owned-a", 9_000),
    ...rows("entered-a", 10_000),
  ];
  return {
    authenticatedOwnerId: "owner-1",
    sourceIdentitySha256: sourceIdentity,
    historyGenerationVersion: "history-generation-v3",
    historicalAggregateVersion: "aggregate-v5",
    evidenceCutoff: "2026-10-16T00:00:00.000Z",
    context,
    coverage: {
      state: "accepted",
      generationIntegrityVerified: true,
      exactContextVerified: true,
      completeForRequestedCores: true,
      truncated: false,
      requestedCoreIds: ["owned-a", "entered-a"],
      totalMatchingRows: acceptedRows.length,
    },
    rows: acceptedRows,
    ...change,
  };
}

function harness(
  change: Readonly<{
    source?: OpenRaceAcceptedHistorySource | null;
    acceptedIdentity?: string | null;
    currentSession?: OpenRaceWorkspaceSession;
    maximumRows?: number;
  }> = {},
) {
  const loadExactContextHistoryByOwner = vi.fn(async () =>
    change.source === undefined ? source() : change.source,
  );
  const readAcceptedSourceIdentityByOwner = vi.fn(async () =>
    change.acceptedIdentity === undefined
      ? sourceIdentity
      : change.acceptedIdentity,
  );
  const boundary: OpenRaceAcceptedHistoryReadBoundary = {
    loadExactContextHistoryByOwner,
    readAcceptedSourceIdentityByOwner,
  };
  return {
    input: {
      authenticatedOwnerId: "owner-1",
      session: change.currentSession ?? session(),
      historyGenerationVersion: "history-generation-v3",
      modelVersion: "empirical-pairwise-v1",
      maximumRows: change.maximumRows ?? 100,
      boundary,
    },
    loadExactContextHistoryByOwner,
    readAcceptedSourceIdentityByOwner,
  };
}

describe("Open Race accepted exact-history reader", () => {
  it("loads one bounded complete generation and feeds the non-actionable scenario", async () => {
    const h = harness();
    const result = await readAcceptedOpenRaceScenarioEvidence(h.input);
    expect(result.status).toBe("ready");
    expect(h.loadExactContextHistoryByOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        requestedCoreIds: ["owned-a", "entered-a"],
        maximumRows: 100,
        evidenceCutoff: "2026-10-16T00:00:00.000Z",
      }),
    );
    expect(h.readAcceptedSourceIdentityByOwner).toHaveBeenCalledWith("owner-1");
    if (result.evidence === null)
      throw new Error("Expected accepted evidence.");
    expect(result.evidence).toMatchObject({
      historyGenerationVersion: "history-generation-v3",
      historySourceIdentitySha256: sourceIdentity,
      candidateHistories: [{ coreId: "owned-a" }],
      opponentHistories: [{ coreId: "entered-a" }],
    });
    expect(
      composePersistedOpenRaceCandidateScenario(
        "owner-1",
        session(),
        result.evidence,
      ),
    ).toMatchObject({
      status: "experimental",
      scenario: {
        status: "available",
        raceEntryAllowed: false,
        gameActionAllowed: false,
      },
    });
  });

  it("does not read history for a stale or post-lock session", async () => {
    for (const currentSession of [
      { ...session(), stage: "locked_observation" as const },
      {
        ...session(),
        field: { ...session().field, freshness: "stale" as const },
      },
    ]) {
      const h = harness({ currentSession });
      await expect(
        readAcceptedOpenRaceScenarioEvidence(h.input),
      ).resolves.toEqual({ status: "source_unavailable", evidence: null });
      expect(h.loadExactContextHistoryByOwner).not.toHaveBeenCalled();
    }
  });

  it("preserves unavailable, incomplete and drifting sources", async () => {
    const unavailable = harness({ source: null });
    await expect(
      readAcceptedOpenRaceScenarioEvidence(unavailable.input),
    ).resolves.toEqual({ status: "source_unavailable", evidence: null });
    expect(
      unavailable.readAcceptedSourceIdentityByOwner,
    ).not.toHaveBeenCalled();

    const partialSource = source({
      coverage: { ...source().coverage, state: "partial" },
    });
    const partial = harness({ source: partialSource });
    await expect(
      readAcceptedOpenRaceScenarioEvidence(partial.input),
    ).resolves.toEqual({ status: "source_incomplete", evidence: null });
    expect(partial.readAcceptedSourceIdentityByOwner).not.toHaveBeenCalled();

    const changed = harness({ acceptedIdentity: "b".repeat(64) });
    await expect(
      readAcceptedOpenRaceScenarioEvidence(changed.input),
    ).resolves.toEqual({ status: "source_changed", evidence: null });
  });

  it.each([
    { truncated: true },
    { completeForRequestedCores: false },
    { generationIntegrityVerified: false },
    { exactContextVerified: false },
    { totalMatchingRows: 19 },
  ])("withholds incomplete coverage %#", async (coverageChange) => {
    const changed = source({
      coverage: { ...source().coverage, ...coverageChange },
    });
    const h = harness({ source: changed });
    await expect(
      readAcceptedOpenRaceScenarioEvidence(h.input),
    ).resolves.toEqual({ status: "source_incomplete", evidence: null });
    expect(h.readAcceptedSourceIdentityByOwner).not.toHaveBeenCalled();
  });

  it("fails closed on cross-owner, source-version or exact-context drift", async () => {
    for (const changed of [
      source({ authenticatedOwnerId: "owner-2" }),
      source({ historyGenerationVersion: "history-generation-v4" }),
      source({ context: { ...context, competition: "esports" } }),
    ]) {
      const h = harness({ source: changed });
      await expect(
        readAcceptedOpenRaceScenarioEvidence(h.input),
      ).rejects.toThrow("Open Race accepted history read unavailable.");
    }
  });

  it("rejects fabricated row context, duplicate identities and post-cutoff evidence", async () => {
    const acceptedRows = source().rows;
    const cases = [
      [
        { ...acceptedRows[0]!, context: { ...context, distanceMeters: 1600 } },
        ...acceptedRows.slice(1),
      ],
      [acceptedRows[0]!, acceptedRows[0]!, ...acceptedRows.slice(2)],
      [
        { ...acceptedRows[0]!, eventAt: "2026-10-16T00:00:00.000Z" },
        ...acceptedRows.slice(1),
      ],
    ];
    for (const changedRows of cases) {
      const h = harness({
        source: source({
          rows: changedRows,
          coverage: {
            ...source().coverage,
            totalMatchingRows: changedRows.length,
          },
        }),
      });
      await expect(
        readAcceptedOpenRaceScenarioEvidence(h.input),
      ).rejects.toThrow("Open Race accepted history read unavailable.");
    }
  });

  it("rejects unbounded reads and context contradicting the saved field", async () => {
    const unbounded = harness({ maximumRows: 10_001 });
    await expect(
      readAcceptedOpenRaceScenarioEvidence(unbounded.input),
    ).rejects.toThrow("Open Race accepted history read unavailable.");
    expect(unbounded.loadExactContextHistoryByOwner).not.toHaveBeenCalled();

    const noContext = harness({
      currentSession: {
        ...session(),
        field: { ...session().field, probabilityContext: null },
      },
    });
    await expect(
      readAcceptedOpenRaceScenarioEvidence(noContext.input),
    ).resolves.toEqual({ status: "source_unavailable", evidence: null });
    expect(noContext.loadExactContextHistoryByOwner).not.toHaveBeenCalled();
  });
});
