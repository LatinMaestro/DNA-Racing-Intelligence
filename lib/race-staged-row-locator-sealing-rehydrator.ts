import type { NeonRaceArchiveCoreLocatorRepository } from "./neon-race-archive-core-locator-repository";
import { createRaceArchiveCoreLocatorAccumulator } from "./race-archive-core-locator-accumulator";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

function positiveSafeInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function builtAt(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Race archive Core locator build timestamp is invalid");
  }
  return value.toISOString();
}

function partitionReferenceCount(
  locators: readonly Readonly<{ partitionNumbers: readonly number[] }>[],
): number {
  let count = 0;
  for (const locator of locators) {
    count += locator.partitionNumbers.length;
    if (!Number.isSafeInteger(count)) {
      throw new Error(
        "Race archive Core locator partition references overflowed",
      );
    }
  }
  return count;
}

export function createRaceStagedRowLocatorSealingRehydrator(input: {
  rehydrator: RaceStagedRowRehydrator;
  coreLocatorRepository: NeonRaceArchiveCoreLocatorRepository;
  maximumCoreLocators?: number;
  maximumPartitionsPerCore?: number;
  now?: () => Date;
}): RaceStagedRowRehydrator {
  const maximumCoreLocators = positiveSafeInteger(
    input.maximumCoreLocators ?? 50_000,
    "maximumCoreLocators",
    50_000,
  );
  const maximumPartitionsPerCore = positiveSafeInteger(
    input.maximumPartitionsPerCore ?? 10_000,
    "maximumPartitionsPerCore",
    10_000,
  );
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async open(request) {
      const opened = await input.rehydrator.open(request);
      if (opened.status === "missing") return opened;

      const manifest = opened.manifest;
      const rows = opened.rows;
      return Object.freeze({
        status: "ready" as const,
        manifest,
        rows: (async function* () {
          const accumulator = createRaceArchiveCoreLocatorAccumulator({
            datasetVersionId: manifest.datasetVersionId,
            importBatchId: manifest.importBatchId,
            maximumCoreLocators,
            maximumPartitionsPerCore,
          });
          let readyRowCount = 0;
          for await (const row of rows) {
            accumulator.append(Object.freeze([row]));
            if (row.stagedRow.row.status === "ready") readyRowCount += 1;
            yield row;
          }

          const locators = accumulator.finish();
          if (readyRowCount < 1 || locators.length < 1) {
            throw new Error(
              "Race archive Core locators cannot be sealed without ready rows",
            );
          }
          const expectedPartitionReferenceCount =
            partitionReferenceCount(locators);
          const receipt = await input.coreLocatorRepository.replace({
            ownerId: request.ownerId,
            datasetVersionId: manifest.datasetVersionId,
            importBatchId: manifest.importBatchId,
            locators,
            builtAt: builtAt(now),
          });
          if (
            (receipt.status !== "sealed" && receipt.status !== "existing") ||
            receipt.datasetVersionId !== manifest.datasetVersionId ||
            receipt.importBatchId !== manifest.importBatchId ||
            receipt.coreLocatorCount !== locators.length ||
            receipt.readyRowCount !== readyRowCount ||
            receipt.partitionReferenceCount !== expectedPartitionReferenceCount
          ) {
            throw new Error(
              "Race archive Core locator receipt conflicts with rehydrated evidence",
            );
          }
        })(),
      });
    },
  });
}
