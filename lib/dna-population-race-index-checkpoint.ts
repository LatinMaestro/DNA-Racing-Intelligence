import {
  adaptDnaRaceDocumentPopulationInventory,
  DnaRaceDocumentAdaptationProcessingError,
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
} from "./dna-open-lab-v1-adapters";
import { DNA_FINISHED_RACE_WINDOW_LIMIT } from "./dna-open-lab-finished-race-window-crawler";
import type {
  DnaOpenLabP5FirstBackfillEvidenceDocument,
  DnaOpenLabP5FirstBackfillEvidenceWriter,
} from "./dna-open-lab-p5-first-backfill-r2-evidence";
import type {
  DnaOpenLabP5FirstBackfillDurableReceipt,
  DnaOpenLabP5FirstBackfillLedger,
} from "./neon-dna-open-lab-p5-first-backfill-ledger";
import type { DnaRaceDocument } from "./dna-open-lab-v1-client";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
export const DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS_PER_BATCH = 500;

export type DnaPopulationRaceIndexDocument = Readonly<{
  requestOrdinal: number;
  endpoint: "races.finished" | "races.docs";
  observedAt: string;
  sourceRaceId: string;
  rawEvidenceSha256: string;
  canonical: CanonicalRaceDocumentMetadata;
}>;

export type DnaPopulationRaceIndexReceiptBatch = Readonly<{
  version: 1;
  baselineCompletionSha256: string;
  afterRequestOrdinal: number;
  nextRequestOrdinal: number;
  processedReceiptCount: number;
  processedReceiptBytes: number;
  processedIdentityOmissionCount: number;
  finishedRaceReceiptCount: number;
  canonicalDocumentObservationCount: number;
  documents: readonly DnaPopulationRaceIndexDocument[];
  complete: boolean;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

export type DnaPopulationRaceIndexBaselineReadPort = Readonly<{
  load: DnaOpenLabP5FirstBackfillLedger["load"];
  loadReceipts: DnaOpenLabP5FirstBackfillLedger["loadReceipts"];
  readEvidence: DnaOpenLabP5FirstBackfillEvidenceWriter["read"];
}>;

function checkpointError(message: string): never {
  throw new Error(`DNA population race index checkpoint: ${message}`);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    checkpointError(`${field} is invalid`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = nonNegativeInteger(value, field);
  if (parsed < 1) checkpointError(`${field} is invalid`);
  return parsed;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    checkpointError(`${field} is invalid`);
  }
  return value;
}

function raceId(raw: DnaRaceDocument): string {
  if (typeof raw.rid === "number") {
    if (!Number.isSafeInteger(raw.rid) || raw.rid < 1) {
      checkpointError("race id is invalid");
    }
    return String(raw.rid);
  }
  if (
    typeof raw.rid !== "string" ||
    raw.rid.trim() === "" ||
    raw.rid.trim() !== raw.rid ||
    /[\u0000-\u001f\u007f]/u.test(raw.rid)
  ) {
    checkpointError("race id is invalid");
  }
  return raw.rid;
}

function raceDocuments(value: unknown): readonly DnaRaceDocument[] {
  if (!Array.isArray(value)) checkpointError("Race response is invalid");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      checkpointError("Race response document is invalid");
    }
    return entry as DnaRaceDocument;
  });
}

function validateEvidence(
  receipt: DnaOpenLabP5FirstBackfillDurableReceipt,
  evidence: DnaOpenLabP5FirstBackfillEvidenceDocument | null,
): DnaOpenLabP5FirstBackfillEvidenceDocument {
  if (
    evidence === null ||
    evidence.family !== receipt.family ||
    evidence.requestOrdinal !== receipt.requestOrdinal ||
    evidence.observedAt !== receipt.observedAt
  ) {
    checkpointError("evidence disagrees with its durable receipt");
  }
  return evidence;
}

/**
 * Validates one contiguous bounded slice of immutable P5 receipts.
 *
 * The returned observations are deliberately not authority on their own. A
 * durable owner-scoped writer must atomically stage them with the returned
 * receipt progress, and must reconcile the accumulated counts to the immutable
 * P5 completion before it may publish a complete population race index.
 */
export async function readDnaPopulationRaceIndexReceiptBatch(input: {
  baseline: DnaPopulationRaceIndexBaselineReadPort;
  baselineCompletionSha256: string;
  baselineLogicalRequestCount: number;
  baselineRetainedR2Bytes: number;
  baselineOmittedIdentityObservationCount: number;
  afterRequestOrdinal: number;
  maximumReceiptCount: number;
}): Promise<DnaPopulationRaceIndexReceiptBatch> {
  const completionSha256 = sha256(
    input.baselineCompletionSha256,
    "baselineCompletionSha256",
  );
  const logicalRequestCount = positiveInteger(
    input.baselineLogicalRequestCount,
    "baselineLogicalRequestCount",
  );
  const retainedR2Bytes = positiveInteger(
    input.baselineRetainedR2Bytes,
    "baselineRetainedR2Bytes",
  );
  const omittedIdentityObservationCount = nonNegativeInteger(
    input.baselineOmittedIdentityObservationCount,
    "baselineOmittedIdentityObservationCount",
  );
  const afterRequestOrdinal = nonNegativeInteger(
    input.afterRequestOrdinal,
    "afterRequestOrdinal",
  );
  const maximumReceiptCount = positiveInteger(
    input.maximumReceiptCount,
    "maximumReceiptCount",
  );
  if (
    maximumReceiptCount >
      DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS_PER_BATCH ||
    afterRequestOrdinal > logicalRequestCount
  ) {
    checkpointError("receipt range is invalid");
  }

  const state = await input.baseline.load();
  if (
    state === null ||
    state.status !== "complete" ||
    state.completionSha256 !== completionSha256 ||
    state.logicalRequestCount !== logicalRequestCount ||
    state.nextRequestOrdinal !== logicalRequestCount + 1 ||
    state.retainedR2Bytes !== retainedR2Bytes ||
    state.omittedIdentityObservationCount !== omittedIdentityObservationCount
  ) {
    checkpointError("immutable P5 baseline authority is unavailable");
  }

  if (afterRequestOrdinal === logicalRequestCount) {
    return Object.freeze({
      version: 1,
      baselineCompletionSha256: completionSha256,
      afterRequestOrdinal,
      nextRequestOrdinal: logicalRequestCount + 1,
      processedReceiptCount: 0,
      processedReceiptBytes: 0,
      processedIdentityOmissionCount: 0,
      finishedRaceReceiptCount: 0,
      canonicalDocumentObservationCount: 0,
      documents: Object.freeze([]),
      complete: true,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
  }

  const receipts = await input.baseline.loadReceipts({
    afterRequestOrdinal,
    limit: Math.min(
      maximumReceiptCount,
      logicalRequestCount - afterRequestOrdinal,
    ),
  });
  if (receipts.length === 0) {
    checkpointError("immutable P5 receipt ledger is incomplete");
  }
  for (const [index, receipt] of receipts.entries()) {
    if (receipt.requestOrdinal !== afterRequestOrdinal + index + 1) {
      checkpointError("immutable P5 receipt ordinals are not contiguous");
    }
  }

  const finishedReceipts = receipts.filter(
    (receipt) => receipt.family === "finished_races",
  );
  const evidence = await Promise.all(
    finishedReceipts.map((receipt) =>
      input.baseline.readEvidence(receipt.requestOrdinal, receipt),
    ),
  );
  const documents: DnaPopulationRaceIndexDocument[] = [];
  let observedIdentityOmissionCount = 0;
  for (const [index, receipt] of finishedReceipts.entries()) {
    const validated = validateEvidence(receipt, evidence[index] ?? null);
    if (
      validated.endpoint !== "races.finished" &&
      validated.endpoint !== "races.docs"
    ) {
      checkpointError("finished-race receipt endpoint is invalid");
    }
    const rawDocuments = raceDocuments(validated.response.result);
    if (
      validated.endpoint === "races.finished" &&
      rawDocuments.length === DNA_FINISHED_RACE_WINDOW_LIMIT
    ) {
      continue;
    }
    for (const raw of rawDocuments) {
      const adapted = (() => {
        try {
          return adaptDnaRaceDocumentPopulationInventory({
            raw,
            observedAt: validated.observedAt,
            endpoint: validated.endpoint,
          });
        } catch (error) {
          if (
            error instanceof DnaRaceDocumentAdaptationProcessingError &&
            error.diagnostic === "race_document_adaptation_identity_unavailable"
          ) {
            observedIdentityOmissionCount += 1;
            return null;
          }
          throw error;
        }
      })();
      if (adapted === null) continue;
      const sourceRaceId = raceId(raw);
      const digest = dnaOpenLabRawEvidenceSha256(raw);
      if (
        adapted.canonical.sourceRaceId !== sourceRaceId ||
        adapted.rawEvidenceSha256 !== digest
      ) {
        checkpointError("canonical Race document identity drifted");
      }
      documents.push(
        Object.freeze({
          requestOrdinal: receipt.requestOrdinal,
          endpoint: validated.endpoint,
          observedAt: validated.observedAt,
          sourceRaceId,
          rawEvidenceSha256: digest,
          canonical: adapted.canonical,
        }),
      );
    }
  }

  const nextOrdinal = receipts.at(-1)!.requestOrdinal;
  return Object.freeze({
    version: 1,
    baselineCompletionSha256: completionSha256,
    afterRequestOrdinal,
    nextRequestOrdinal: nextOrdinal + 1,
    processedReceiptCount: receipts.length,
    processedReceiptBytes: receipts.reduce(
      (sum, receipt) => sum + receipt.byteLength,
      0,
    ),
    processedIdentityOmissionCount: observedIdentityOmissionCount,
    finishedRaceReceiptCount: finishedReceipts.length,
    canonicalDocumentObservationCount: documents.length,
    documents: Object.freeze(documents),
    complete: nextOrdinal === logicalRequestCount,
    persistentWritePerformed: false,
    paidUsageAllowed: false,
  });
}
