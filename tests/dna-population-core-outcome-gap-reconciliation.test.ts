import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import type { DnaCompactCoreOutcomeEvidence } from "@/lib/dna-population-core-outcome-gap-plan";
import { reconcileDnaPopulationCoreOutcomeGap } from "@/lib/dna-population-core-outcome-gap-reconciliation";
import type { DnaPopulationCoreRaceLink } from "@/lib/dna-population-core-race-link-index";
import { createEphemeralJsonlExternalSortedRunStore } from "@/lib/ephemeral-jsonl-external-sorted-run-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function documents(
  values: readonly CanonicalRaceDocumentMetadata[],
): AsyncIterable<CanonicalRaceDocumentMetadata> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function race(input: {
  id: string;
  mode?: "bike" | "car" | "horse";
  entrants?: readonly string[];
}): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document",
    sourceRaceId: input.id,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.entrants === undefined ? {} : { entrantCoreIds: input.entrants }),
  });
}

function outcome(input: {
  source: DnaCompactCoreOutcomeEvidence["source"];
  coreId: number;
  raceId: string;
  position: number;
  elapsedMilliseconds: number;
}): DnaCompactCoreOutcomeEvidence {
  return Object.freeze({
    source: input.source,
    sourceCoreId: input.coreId,
    sourceRaceId: input.raceId,
    finishPosition: input.position,
    elapsedMilliseconds: input.elapsedMilliseconds,
  });
}

async function reconcile(input: {
  races: readonly CanonicalRaceDocumentMetadata[];
  raceMerge: ReadonlyMap<number, readonly DnaCompactCoreOutcomeEvidence[]>;
  api?: ReadonlyMap<number, readonly DnaCompactCoreOutcomeEvidence[]>;
}) {
  const root = await mkdtemp(join(tmpdir(), "dna-outcome-gap-reconcile-"));
  roots.push(root);
  return reconcileDnaPopulationCoreOutcomeGap({
    documents: documents(input.races),
    scratchStore:
      createEphemeralJsonlExternalSortedRunStore<DnaPopulationCoreRaceLink>({
        rootDirectory: root,
        namespace: "core-race-membership",
      }),
    runPrefix: "core-race-membership",
    linkIndexBounds: {
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumMemberships: 100,
      maximumRunObjects: 100,
      maximumRacesPerCore: 100,
    },
    planBounds: {
      maximumLinkedCores: 100,
      maximumRequiredMemberships: 100,
      maximumOutcomesPerSourcePerCore: 100,
    },
    maximumConcurrentCoreLoads: 2,
    raceMergeSource: {
      loadOutcomes: async (coreId) =>
        input.raceMerge.get(coreId) ?? Object.freeze([]),
    },
    persistedApiSource: {
      loadOutcomes: async (coreId) =>
        input.api?.get(coreId) ?? Object.freeze([]),
    },
  });
}

describe("DNA population Core outcome gap reconciliation", () => {
  it("joins canonical membership to Race Merge first, persisted API second, and emits only the true gap", async () => {
    const report = await reconcile({
      races: [
        race({ id: "race-1", mode: "bike", entrants: ["10", "20"] }),
        race({ id: "race-2", mode: "car", entrants: ["10"] }),
        race({ id: "race-3", mode: "horse", entrants: ["20"] }),
        race({ id: "race-quarantine", mode: "bike" }),
      ],
      raceMerge: new Map([
        [
          10,
          [
            outcome({
              source: "race_merge",
              coreId: 10,
              raceId: "race-1",
              position: 1,
              elapsedMilliseconds: 50_001,
            }),
            outcome({
              source: "race_merge",
              coreId: 10,
              raceId: "race-1",
              position: 1,
              elapsedMilliseconds: 50_001,
            }),
          ],
        ],
        [
          20,
          [
            outcome({
              source: "race_merge",
              coreId: 20,
              raceId: "race-1",
              position: 2,
              elapsedMilliseconds: 60_001,
            }),
          ],
        ],
      ]),
      api: new Map([
        [
          10,
          [
            outcome({
              source: "core_history_api",
              coreId: 10,
              raceId: "race-1",
              position: 1,
              elapsedMilliseconds: 50_001,
            }),
            outcome({
              source: "core_history_api",
              coreId: 10,
              raceId: "race-2",
              position: 2,
              elapsedMilliseconds: 50_002,
            }),
          ],
        ],
      ]),
    });

    expect(report).toMatchObject({
      status: "complete",
      raceAuthority: {
        status: "complete_for_resolved_race_authority",
        raceDocumentCount: 4,
        resolvedRaceCount: 3,
        quarantinedRaceCount: 1,
        linkedCoreCount: 2,
        membershipCount: 4,
        membershipSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      outcomeCoverage: {
        status: "complete",
        linkedCoreCount: 2,
        requiredMembershipCount: 4,
        coveredMembershipCount: 3,
        raceMergeCoveredMembershipCount: 2,
        apiCoveredMembershipCount: 1,
        exactCrossSourceOverlapCount: 1,
        replayDuplicateCount: 1,
        extraOutcomeCount: 0,
        missingMembershipCount: 1,
        apiGapCoreCount: 1,
        apiGapCoreIds: [20],
        requiredMembershipSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        coveredMembershipSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        missingMembershipSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        dnaProviderRequestCount: 0,
      },
      dnaProviderRequestCount: 0,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("fails closed when Race Merge and persisted API disagree on a required outcome", async () => {
    await expect(
      reconcile({
        races: [race({ id: "race-1", mode: "bike", entrants: ["10"] })],
        raceMerge: new Map([
          [
            10,
            [
              outcome({
                source: "race_merge",
                coreId: 10,
                raceId: "race-1",
                position: 1,
                elapsedMilliseconds: 50_000,
              }),
            ],
          ],
        ]),
        api: new Map([
          [
            10,
            [
              outcome({
                source: "core_history_api",
                coreId: 10,
                raceId: "race-1",
                position: 2,
                elapsedMilliseconds: 50_000,
              }),
            ],
          ],
        ]),
      }),
    ).rejects.toThrow("Race Merge and API outcomes conflict");
  });
});
