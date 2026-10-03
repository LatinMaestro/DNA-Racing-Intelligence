import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDnaPopulationCoreRaceLinkIndex,
  type DnaPopulationCoreRaceLink,
} from "@/lib/dna-population-core-race-link-index";
import { createEphemeralJsonlExternalSortedRunStore } from "@/lib/ephemeral-jsonl-external-sorted-run-store";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
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

async function build(values: readonly CanonicalRaceDocumentMetadata[]) {
  const root = await mkdtemp(join(tmpdir(), "dna-core-race-links-"));
  roots.push(root);
  return buildDnaPopulationCoreRaceLinkIndex({
    documents: documents(values),
    store:
      createEphemeralJsonlExternalSortedRunStore<DnaPopulationCoreRaceLink>({
        rootDirectory: root,
        namespace: "population-core-race-links",
      }),
    runPrefix: "population-core-race-links",
    bounds: {
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumMemberships: 100,
      maximumRunObjects: 100,
      maximumRacesPerCore: 100,
    },
  });
}

describe("DNA population Core-Race link index", () => {
  it("builds complete resolved Core history from retained Races without API reads or Race copies", async () => {
    const index = await build([
      race({ id: "race-3", mode: "horse", entrants: ["20"] }),
      race({ id: "race-1", mode: "bike", entrants: ["10", "20"] }),
      race({ id: "race-2", mode: "car", entrants: ["10"] }),
    ]);
    const histories = [];
    for await (const history of index.read()) histories.push(history);

    expect(index).toMatchObject({
      status: "complete_for_resolved_race_authority",
      raceDocumentCount: 3,
      resolvedRaceCount: 3,
      quarantinedRaceCount: 0,
      linkedCoreCount: 2,
      membershipCount: 4,
      membershipSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      dnaProviderRequestCount: 0,
      raceDocumentDuplicationPerformed: false,
      performanceEnrichmentRequiredForLinkedHistory: false,
    });
    expect(histories).toEqual([
      {
        sourceCoreId: 10,
        raceCount: 2,
        raceIdsByMode: { bike: ["race-1"], car: ["race-2"], horse: [] },
      },
      {
        sourceCoreId: 20,
        raceCount: 2,
        raceIdsByMode: { bike: ["race-1"], car: [], horse: ["race-3"] },
      },
    ]);
    await index.cleanup();
  });

  it("quarantines incomplete Race authority without blocking resolved linked histories", async () => {
    const index = await build([
      race({ id: "race-1", mode: "bike", entrants: ["10"] }),
      race({ id: "race-2", mode: "car" }),
      race({ id: "race-3", entrants: ["20"] }),
      race({ id: "race-4", mode: "horse", entrants: ["30", "30"] }),
    ]);
    const histories = [];
    for await (const history of index.read()) histories.push(history);

    expect(index).toMatchObject({
      raceDocumentCount: 4,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 3,
      linkedCoreCount: 1,
      membershipCount: 1,
    });
    expect(histories).toEqual([
      {
        sourceCoreId: 10,
        raceCount: 1,
        raceIdsByMode: { bike: ["race-1"], car: [], horse: [] },
      },
    ]);
    await index.cleanup();
  });

  it("fails closed on duplicate Race membership instead of silently copying history", async () => {
    await expect(
      build([
        race({ id: "race-1", mode: "bike", entrants: ["10"] }),
        race({ id: "race-1", mode: "bike", entrants: ["10"] }),
      ]),
    ).rejects.toThrow("duplicate Core-Race membership");
  });

  it("fails closed when one Core exceeds the configured linked-Race bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "dna-core-race-links-"));
    roots.push(root);
    await expect(
      buildDnaPopulationCoreRaceLinkIndex({
        documents: documents([
          race({ id: "race-1", mode: "bike", entrants: ["10"] }),
          race({ id: "race-2", mode: "car", entrants: ["10"] }),
        ]),
        store:
          createEphemeralJsonlExternalSortedRunStore<DnaPopulationCoreRaceLink>(
            {
              rootDirectory: root,
              namespace: "population-core-race-links-bound",
            },
          ),
        runPrefix: "population-core-race-links-bound",
        bounds: {
          maximumRecordsInMemory: 2,
          mergeFanIn: 2,
          maximumMemberships: 100,
          maximumRunObjects: 100,
          maximumRacesPerCore: 1,
        },
      }),
    ).rejects.toThrow("one Core exceeds the linked Race bound");
  });
});
