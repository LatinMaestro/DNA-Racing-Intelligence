import {
  applyDnaCoreRaceHistoryPageReceipt,
  completeDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryCoreCheckpoint,
  validateDnaCoreRaceHistoryAcquisitionCycle,
  validateDnaCoreRaceHistoryCoreCheckpoint,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type DnaCoreRaceHistoryCoreCheckpoint,
} from "./dna-core-race-history-acquisition-cycle";
import {
  publishDnaCoreRaceHistoryGeneration,
  type DnaCoreRaceHistoryGenerationRepository,
  type DnaCoreRaceHistoryPublishedGeneration,
} from "./dna-core-race-history-generation";
import {
  materializeDnaCoreRaceHistory,
  type DnaCoreRaceHistoryMaterializationPage,
} from "./dna-core-race-history-materialization";
import type { DnaCoreRaceHistoryMaterializationEvidenceStore } from "./dna-core-race-history-r2-evidence";
import {
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";

export const DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_BATCH_SIZE = 25;
export const DNA_CORE_RACE_HISTORY_PAGE_READ_CLASS_B_OPERATION_CEILING = 4;
export const DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_PAGES = 50_000;
export const DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_RESULTS = 500_000;
export const DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_RACE_DOCUMENTS = 500_000;

export type DnaCoreRaceHistoryGenerationMaterializerResult =
  | Readonly<{
      kind: "authority_unavailable";
      reason: "no_complete_cycle" | "historical_lineage_required";
    }>
  | Readonly<{
      kind: "published";
      generation: DnaCoreRaceHistoryPublishedGeneration;
    }>;

function unavailable(message: string): never {
  throw new Error(`DNA Core race history generation materializer: ${message}`);
}

function timestamp(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    return unavailable(`${field} is invalid`);
  }
  return new Date(value).toISOString();
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    return unavailable(`${field} is outside its safe bound`);
  }
  return value;
}

function safeOwner(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return unavailable("owner authority is invalid");
  }
  return value;
}

function sameCanonicalAuthority(left: unknown, right: unknown): boolean {
  return (
    dnaOpenLabRawEvidenceSha256(left) === dnaOpenLabRawEvidenceSha256(right)
  );
}

/**
 * Replays a root completed owner-scoped full-history cycle from immutable R2
 * evidence, hydrates its exact race identities in bounded batches, and
 * publishes one complete joined generation. Successor cycles hold until their
 * complete historical lineage can be composed without dropping prior Cores.
 * Missing, partial or conflicting evidence fails before the last-good pointer
 * can move.
 */
export async function materializeAndPublishLatestDnaCoreRaceHistory(input: {
  ownerId: string;
  workerId: string;
  materializedAt: string;
  publishedAt: string;
  acquisitionRepository: DnaCoreRaceHistoryAcquisitionRepository;
  evidenceStore: DnaCoreRaceHistoryMaterializationEvidenceStore;
  loadRaceDocuments: (
    sourceRaceIds: readonly string[],
  ) => Promise<readonly DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>[]>;
  generationRepository: DnaCoreRaceHistoryGenerationRepository;
  retainedEvidenceReadBudget: Readonly<{
    maximumClassBOperations: number;
    paidUsageAllowed: false;
  }>;
  maximumPages?: number;
  maximumResults?: number;
  maximumRaceDocuments?: number;
}): Promise<DnaCoreRaceHistoryGenerationMaterializerResult> {
  const ownerId = safeOwner(input.ownerId);
  const materializedAt = timestamp(input.materializedAt, "materializedAt");
  const publishedAt = timestamp(input.publishedAt, "publishedAt");
  if (Date.parse(publishedAt) < Date.parse(materializedAt)) {
    return unavailable("publishedAt predates materializedAt");
  }
  const maximumPages = positiveBound(
    input.maximumPages ?? DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_PAGES,
    "maximumPages",
    DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_PAGES,
  );
  const maximumResults = positiveBound(
    input.maximumResults ?? DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_RESULTS,
    "maximumResults",
    DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_RESULTS,
  );
  const maximumRaceDocuments = positiveBound(
    input.maximumRaceDocuments ??
      DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_RACE_DOCUMENTS,
    "maximumRaceDocuments",
    DNA_CORE_RACE_HISTORY_MATERIALIZER_MAXIMUM_RACE_DOCUMENTS,
  );
  if (
    input.retainedEvidenceReadBudget.paidUsageAllowed !== false ||
    !Number.isSafeInteger(
      input.retainedEvidenceReadBudget.maximumClassBOperations,
    ) ||
    input.retainedEvidenceReadBudget.maximumClassBOperations < 0
  ) {
    return unavailable("retained-evidence read budget is invalid");
  }

  const stored = await input.acquisitionRepository.loadLatestComplete();
  if (stored === null) {
    return Object.freeze({
      kind: "authority_unavailable" as const,
      reason: "no_complete_cycle" as const,
    });
  }
  const cycle = validateDnaCoreRaceHistoryAcquisitionCycle(stored.cycle);
  if (cycle.status !== "complete" || cycle.completion === null) {
    return unavailable("latest cycle is not complete");
  }
  if (Date.parse(cycle.completion.completedAt) > Date.parse(materializedAt)) {
    return unavailable("materialization predates cycle completion");
  }
  if (cycle.previousCompletedCycleId !== null) {
    return Object.freeze({
      kind: "authority_unavailable" as const,
      reason: "historical_lineage_required" as const,
    });
  }

  const replayCycle = createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: cycle.previousCompletedCycleId,
    currentStateGenerationId: cycle.currentStateGenerationId,
    evaluatedAt: cycle.evaluatedAt,
    coreIds: cycle.coreIds,
    attemptNumber: cycle.attemptNumber,
  });
  if (
    replayCycle.cycleId !== cycle.cycleId ||
    replayCycle.attemptId !== cycle.attemptId
  ) {
    return unavailable("completed cycle authority drifted");
  }

  const storedCheckpoints = await input.acquisitionRepository.loadCores({
    cycleId: cycle.cycleId,
    attemptNumber: cycle.attemptNumber,
  });
  if (storedCheckpoints.length !== cycle.coreIds.length) {
    return unavailable("checkpoint coverage is incomplete");
  }
  const checkpoints = storedCheckpoints
    .map(({ checkpoint }) =>
      validateDnaCoreRaceHistoryCoreCheckpoint(checkpoint),
    )
    .sort((left, right) => left.coreOrdinal - right.coreOrdinal);
  if (
    checkpoints.some(
      (checkpoint, index) =>
        checkpoint.cycleId !== cycle.cycleId ||
        checkpoint.attemptNumber !== cycle.attemptNumber ||
        checkpoint.coreId !== cycle.coreIds[index] ||
        checkpoint.coreOrdinal !== index + 1 ||
        checkpoint.status !== "complete" ||
        checkpoint.terminalPageNumber === null ||
        checkpoint.completedPageCount !== checkpoint.terminalPageNumber,
    )
  ) {
    return unavailable("checkpoint identity or completion drifted");
  }
  const checkpointTotals = checkpoints.reduce(
    (totals, checkpoint) => ({
      pageReceiptCount: totals.pageReceiptCount + checkpoint.completedPageCount,
      sourceRowCount: totals.sourceRowCount + checkpoint.sourceRowCount,
      acceptedResultCount:
        totals.acceptedResultCount + checkpoint.acceptedResultCount,
      quarantineCount: totals.quarantineCount + checkpoint.quarantineCount,
      replayDuplicateCount:
        totals.replayDuplicateCount + checkpoint.replayDuplicateCount,
    }),
    {
      pageReceiptCount: 0,
      sourceRowCount: 0,
      acceptedResultCount: 0,
      quarantineCount: 0,
      replayDuplicateCount: 0,
    },
  );
  for (const key of Object.keys(checkpointTotals) as Array<
    keyof typeof checkpointTotals
  >) {
    if (checkpointTotals[key] !== cycle.completion[key]) {
      return unavailable("checkpoint totals disagree with cycle completion");
    }
  }
  if (checkpointTotals.pageReceiptCount > maximumPages) {
    return unavailable("completed page coverage exceeds its safe bound");
  }
  const requiredPageReadClassBOperations =
    checkpointTotals.pageReceiptCount *
    DNA_CORE_RACE_HISTORY_PAGE_READ_CLASS_B_OPERATION_CEILING;
  if (
    !Number.isSafeInteger(requiredPageReadClassBOperations) ||
    requiredPageReadClassBOperations >
      input.retainedEvidenceReadBudget.maximumClassBOperations
  ) {
    return unavailable("retained-evidence read budget is closed");
  }

  const pages: DnaCoreRaceHistoryMaterializationPage[] = [];
  const replayedCheckpoints: DnaCoreRaceHistoryCoreCheckpoint[] = [];
  let resultCount = 0;
  let sourceRowCount = 0;
  for (const checkpoint of checkpoints) {
    let replayedCheckpoint = createDnaCoreRaceHistoryCoreCheckpoint({
      cycle: replayCycle,
      coreId: checkpoint.coreId,
    });
    for (
      let pageNumber = 1;
      pageNumber <= checkpoint.terminalPageNumber!;
      pageNumber += 1
    ) {
      const retained = await input.evidenceStore.readMaterializationPage({
        cycle,
        coreId: checkpoint.coreId,
        pageNumber,
      });
      if (retained === null) return unavailable("retained page is unavailable");
      const { page, receipt } = retained;
      if (
        page.ownerId !== ownerId ||
        page.cycleId !== cycle.cycleId ||
        page.attemptNumber !== cycle.attemptNumber ||
        page.coreId !== checkpoint.coreId ||
        page.pageNumber !== pageNumber ||
        page.terminal !== (pageNumber === checkpoint.terminalPageNumber) ||
        receipt.cycleId !== page.cycleId ||
        receipt.attemptNumber !== page.attemptNumber ||
        receipt.coreId !== page.coreId ||
        receipt.pageNumber !== page.pageNumber ||
        receipt.terminal !== page.terminal ||
        receipt.sourceRowCount !== page.sourceRowCount ||
        receipt.acceptedResultCount !== page.results.length ||
        page.results.some((result) => result.observedAt !== receipt.observedAt)
      ) {
        return unavailable("retained page receipt or content drifted");
      }
      replayedCheckpoint = applyDnaCoreRaceHistoryPageReceipt({
        checkpoint: replayedCheckpoint,
        receipt,
      });
      pages.push(page);
      resultCount += page.results.length;
      sourceRowCount += page.sourceRowCount;
      if (resultCount > maximumResults) {
        return unavailable("result coverage exceeds its safe bound");
      }
    }
    if (!sameCanonicalAuthority(replayedCheckpoint, checkpoint)) {
      return unavailable("retained receipt chain disagrees with checkpoint");
    }
    replayedCheckpoints.push(replayedCheckpoint);
  }
  if (
    pages.length !== checkpointTotals.pageReceiptCount ||
    sourceRowCount !== checkpointTotals.sourceRowCount ||
    resultCount !== checkpointTotals.acceptedResultCount
  ) {
    return unavailable("retained page coverage disagrees with completion");
  }
  const replayedCycle = completeDnaCoreRaceHistoryAcquisitionCycle({
    cycle: replayCycle,
    checkpoints: replayedCheckpoints,
    completedAt: cycle.completion.completedAt,
  });
  if (!sameCanonicalAuthority(replayedCycle, cycle)) {
    return unavailable("replayed completion disagrees with cycle");
  }

  const sourceRaceIds = [
    ...new Set(
      pages.flatMap((page) =>
        page.results.map((result) => result.canonical.sourceRaceId),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (sourceRaceIds.length > maximumRaceDocuments) {
    return unavailable("race-document coverage exceeds its safe bound");
  }
  const raceDocuments: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>[] = [];
  for (
    let offset = 0;
    offset < sourceRaceIds.length;
    offset += DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_BATCH_SIZE
  ) {
    const requested = sourceRaceIds.slice(
      offset,
      offset + DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_BATCH_SIZE,
    );
    const loaded = await input.loadRaceDocuments(requested);
    if (loaded.length > requested.length) {
      return unavailable("race-document loader returned excess evidence");
    }
    raceDocuments.push(...loaded);
  }

  const materialization = materializeDnaCoreRaceHistory({
    ownerId,
    cycles: [
      Object.freeze({
        ownerId,
        cycleId: cycle.cycleId,
        attemptNumber: cycle.attemptNumber,
        status: "complete" as const,
        evaluatedAt: cycle.evaluatedAt,
        completedAt: cycle.completion.completedAt,
        coreIds: cycle.coreIds.map(String),
      }),
    ],
    pages,
    raceDocuments,
    materializedAt,
    maximumPages,
    maximumResults,
    maximumRaceDocuments,
  });
  return Object.freeze({
    kind: "published" as const,
    generation: await publishDnaCoreRaceHistoryGeneration({
      ownerId,
      workerId: input.workerId,
      publishedAt,
      materialization,
      repository: input.generationRepository,
    }),
  });
}
