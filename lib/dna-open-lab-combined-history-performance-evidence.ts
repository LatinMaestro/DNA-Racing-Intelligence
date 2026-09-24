import { createHash } from "node:crypto";

import {
  adaptDnaRaceDocument,
  adaptDnaRaceDocumentPopulationInventory,
  DnaRaceDocumentAdaptationProcessingError,
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
} from "./dna-open-lab-v1-adapters";
import type {
  DnaOpenLabP5FirstBackfillEvidenceDocument,
  DnaOpenLabP5FirstBackfillEvidenceWriter,
} from "./dna-open-lab-p5-first-backfill-r2-evidence";
import type { DnaPopulationRaceIndexDocument } from "./dna-population-race-index-checkpoint";
import type { DnaRaceDocument } from "./dna-open-lab-v1-client";
import { DNA_FINISHED_RACE_WINDOW_LIMIT } from "./dna-open-lab-finished-race-window-crawler";
import type {
  DnaOpenLabP5FirstBackfillDurableReceipt,
  DnaOpenLabP5FirstBackfillLedger,
  DnaOpenLabP5FirstBackfillLedgerState,
} from "./neon-dna-open-lab-p5-first-backfill-ledger";
import type { DnaOpenLabCombinedFinishedHistory } from "./neon-dna-open-lab-sync-publication";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "./dna-open-lab-zero-cost-refresh-policy";

const JSON_CONTENT_TYPE = "application/json";
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const MAXIMUM_OBJECT_BYTES = 8 * 1024 * 1024;
const RECEIPT_PAGE_SIZE = 500;
const BASELINE_EVIDENCE_READ_CONCURRENCY = 64;

type ReadableObjectStorage = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "headObject"
> &
  Readonly<{
    getObject: (input: { bucketName: string; key: string }) => Promise<
      | Readonly<{ status: "missing" }>
      | Readonly<{
          status: "ready";
          body: AsyncIterable<Uint8Array>;
        }>
    >;
  }>;

export type DnaOpenLabP5FinishedHistoryReadPort = Readonly<{
  load: DnaOpenLabP5FirstBackfillLedger["load"];
  loadReceipts: DnaOpenLabP5FirstBackfillLedger["loadReceipts"];
  readEvidence: DnaOpenLabP5FirstBackfillEvidenceWriter["read"];
}>;

export type DnaOpenLabP5FinishedHistoryAuthority = Readonly<{
  logicalRequestCount: number;
  retainedR2Bytes: number;
  omittedIdentityObservationCount: number;
  completionSha256: string;
}>;

export type DnaOpenLabHistoryReadBudgetAuthorization = Readonly<{
  maximumClassBOperations: number;
  paidUsageAllowed: false;
}>;

export type DnaOpenLabCompactPopulationBaseline = Readonly<{
  documents: readonly DnaPopulationRaceIndexDocument[];
  baselineReceiptCount: number;
  baselineFinishedRaceReceiptCount: number;
  baselineIdentityOmissionObservationCount: number;
  r2ClassBOperationsUsed: number;
}>;

export type DnaOpenLabCombinedHistoryPerformanceEvidenceAssessment = Readonly<{
  authority: "complete_serving_generation_combined_finished_history";
  refreshCycleId: string;
  currentStateGenerationId: string;
  baselineReceiptCount: number;
  baselineFinishedRaceReceiptCount: number;
  incrementalWindowCount: number;
  incrementalDocumentReferenceCount: number;
  quarantinedIdentityObservationCount: number;
  r2ClassBOperationsUsed: number;
  uniqueRaceCount: number;
  duplicateRaceEvidenceCount: number;
  conflictingRaceEvidenceCount: number;
  bikeRaceCount: number;
  bikeRaceWithFormatCount: number;
  bikeRaceWithTrackSourceValueCount: number;
  exactTypeAndDistanceElapsedObservationCount: 0;
  performanceSelectionStatus: "held_without_exact_format_elapsed_time_evidence";
  unavailableAuthorities: readonly [
    "authoritative_exact_distance",
    "authoritative_elapsed_time",
    "authoritative_finish_position",
  ];
  rawEvidenceExposed: false;
  persistentWritePerformed: false;
  paidUsageAllowed: false;
}>;

type ManifestDocumentReference = Readonly<{
  sourceRaceId: string;
  rawEvidenceSha256: string;
  objectKey: string;
}>;

type ManifestQuarantineReference = Readonly<{
  evidenceLocatorSha256: string;
  rawEvidenceSha256: string;
  objectKey: string;
  bodySha256: string;
  byteLength: number;
}>;

type FinishedWindowManifest = Readonly<{
  schemaVersion: 2;
  source: "dna_open_lab";
  sourceVersion: "v1";
  endpoint: "races.finished";
  windowKey: string;
  contentSha256: string;
  window: Readonly<{ startTime: string; endTime: string }>;
  discoveredRaces: readonly unknown[];
  raceDocumentObjects: readonly ManifestDocumentReference[];
  identityConflictQuarantineObjects: readonly ManifestQuarantineReference[];
}>;

function historyError(message: string): never {
  throw new Error(`DNA Open Lab combined history evidence: ${message}`);
}

function safeText(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    historyError(`${field} is invalid`);
  }
  return value.trim();
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Value(value: unknown, field: string): string {
  const normalized = safeText(value, field).toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) historyError(`${field} is invalid`);
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    historyError(`${field} is invalid`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    historyError(`${field} is invalid`);
  }
  return Number(value);
}

function record(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    historyError(`${field} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function timestamp(value: unknown, field: string): string {
  const normalized = safeText(value, field);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) historyError(`${field} is invalid`);
  return new Date(parsed).toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) historyError("evidence is not canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return historyError("evidence is not canonical JSON");
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-owner\u0000${safeText(ownerId, "ownerId")}`, "utf8")
    .digest("hex");
}

function raceIdentityHash(sourceRaceId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-race\u0000${sourceRaceId}`, "utf8")
    .digest("hex");
}

function metadata(
  values: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  return safeText(values[key], `metadata ${key}`);
}

async function exactObjectBody(input: {
  storage: ReadableObjectStorage;
  bucketName: string;
  key: string;
  byteLength: number;
}): Promise<Uint8Array> {
  const opened = await input.storage.getObject({
    bucketName: input.bucketName,
    key: input.key,
  });
  if (opened.status !== "ready") historyError("evidence object is unavailable");
  const bytes = new Uint8Array(input.byteLength);
  let offset = 0;
  for await (const chunk of opened.body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > bytes.length
    ) {
      historyError("evidence object exceeds its receipt");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== bytes.length) historyError("evidence object is truncated");
  return bytes;
}

function parsedJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return historyError("evidence object is not valid UTF-8 JSON");
  }
}

function raceId(raw: DnaRaceDocument): string {
  if (typeof raw.rid === "number") {
    if (!Number.isSafeInteger(raw.rid) || raw.rid < 1) {
      historyError("race id is invalid");
    }
    return String(raw.rid);
  }
  return safeText(raw.rid, "race id");
}

function raceDocuments(
  value: unknown,
  field: string,
): readonly DnaRaceDocument[] {
  if (!Array.isArray(value)) historyError(`${field} is invalid`);
  return value.map(
    (entry, index) => record(entry, `${field}[${index}]`) as DnaRaceDocument,
  );
}

function validateBaselineState(
  state: DnaOpenLabP5FirstBackfillLedgerState | null,
  authority: DnaOpenLabP5FinishedHistoryAuthority,
): DnaOpenLabP5FirstBackfillLedgerState {
  if (
    state === null ||
    state.status !== "complete" ||
    state.logicalRequestCount !==
      positiveInteger(
        authority.logicalRequestCount,
        "authority logicalRequestCount",
      ) ||
    state.nextRequestOrdinal !== authority.logicalRequestCount + 1 ||
    state.retainedR2Bytes !==
      positiveInteger(authority.retainedR2Bytes, "authority retainedR2Bytes") ||
    state.omittedIdentityObservationCount !==
      nonNegativeInteger(
        authority.omittedIdentityObservationCount,
        "authority omission count",
      ) ||
    state.completionSha256 !==
      sha256Value(authority.completionSha256, "authority completionSha256")
  ) {
    historyError(
      "immutable P5 baseline authority is incomplete or inconsistent",
    );
  }
  return state;
}

async function loadBaselineReceipts(input: {
  source: DnaOpenLabP5FinishedHistoryReadPort;
  state: DnaOpenLabP5FirstBackfillLedgerState;
}): Promise<readonly DnaOpenLabP5FirstBackfillDurableReceipt[]> {
  const receipts: DnaOpenLabP5FirstBackfillDurableReceipt[] = [];
  let afterRequestOrdinal = 0;
  while (receipts.length < input.state.logicalRequestCount) {
    const page = await input.source.loadReceipts({
      afterRequestOrdinal,
      limit: Math.min(
        RECEIPT_PAGE_SIZE,
        input.state.logicalRequestCount - receipts.length,
      ),
    });
    if (page.length === 0)
      historyError("immutable P5 receipt ledger is incomplete");
    for (const receipt of page) {
      if (receipt.requestOrdinal !== receipts.length + 1) {
        historyError("immutable P5 receipt ordinals are not contiguous");
      }
      receipts.push(receipt);
    }
    afterRequestOrdinal = receipts.at(-1)?.requestOrdinal ?? 0;
  }
  if (
    receipts.reduce((sum, receipt) => sum + receipt.byteLength, 0) !==
      input.state.retainedR2Bytes ||
    receipts.reduce(
      (sum, receipt) => sum + receipt.omittedIdentityObservationCount,
      0,
    ) !== input.state.omittedIdentityObservationCount
  ) {
    historyError(
      "immutable P5 receipts do not reconcile to baseline authority",
    );
  }
  return Object.freeze(receipts);
}

function validateBaselineEvidence(input: {
  receipt: DnaOpenLabP5FirstBackfillDurableReceipt;
  evidence: DnaOpenLabP5FirstBackfillEvidenceDocument | null;
}): DnaOpenLabP5FirstBackfillEvidenceDocument {
  if (
    input.evidence === null ||
    input.evidence.family !== input.receipt.family ||
    input.evidence.requestOrdinal !== input.receipt.requestOrdinal ||
    input.evidence.observedAt !== input.receipt.observedAt
  ) {
    historyError("immutable P5 evidence disagrees with its durable receipt");
  }
  return input.evidence;
}

function manifest(value: unknown): FinishedWindowManifest {
  const row = record(value, "incremental manifest");
  const window = record(row.window, "incremental manifest window");
  const references = Array.isArray(row.raceDocumentObjects)
    ? row.raceDocumentObjects.map((entry, index) => {
        const reference = record(entry, `manifest race document ${index}`);
        return Object.freeze({
          sourceRaceId: safeText(
            reference.sourceRaceId,
            "manifest sourceRaceId",
          ),
          rawEvidenceSha256: sha256Value(
            reference.rawEvidenceSha256,
            "manifest rawEvidenceSha256",
          ),
          objectKey: safeText(reference.objectKey, "manifest objectKey"),
        });
      })
    : historyError("manifest race documents are invalid");
  const quarantineReferences = Array.isArray(
    row.identityConflictQuarantineObjects,
  )
    ? row.identityConflictQuarantineObjects.map((entry, index) => {
        const reference = record(entry, `manifest quarantine object ${index}`);
        return Object.freeze({
          evidenceLocatorSha256: sha256Value(
            reference.evidenceLocatorSha256,
            "manifest quarantine evidenceLocatorSha256",
          ),
          rawEvidenceSha256: sha256Value(
            reference.rawEvidenceSha256,
            "manifest quarantine rawEvidenceSha256",
          ),
          objectKey: safeText(
            reference.objectKey,
            "manifest quarantine objectKey",
          ),
          bodySha256: sha256Value(
            reference.bodySha256,
            "manifest quarantine bodySha256",
          ),
          byteLength: positiveInteger(
            reference.byteLength,
            "manifest quarantine byteLength",
          ),
        });
      })
    : historyError("manifest quarantine objects are invalid");
  if (!Array.isArray(row.discoveredRaces)) {
    historyError("incremental manifest collections are invalid");
  }
  if (
    row.schemaVersion !== 2 ||
    row.source !== "dna_open_lab" ||
    row.sourceVersion !== "v1" ||
    row.endpoint !== "races.finished"
  ) {
    historyError("incremental manifest authority is invalid");
  }
  return Object.freeze({
    schemaVersion: 2,
    source: "dna_open_lab",
    sourceVersion: "v1",
    endpoint: "races.finished",
    windowKey: sha256Value(row.windowKey, "manifest windowKey"),
    contentSha256: sha256Value(row.contentSha256, "manifest contentSha256"),
    window: Object.freeze({
      startTime: timestamp(window.startTime, "manifest window startTime"),
      endTime: timestamp(window.endTime, "manifest window endTime"),
    }),
    discoveredRaces: row.discoveredRaces,
    raceDocumentObjects: Object.freeze(references),
    identityConflictQuarantineObjects: Object.freeze(quarantineReferences),
  });
}

/**
 * Reads only the immutable P5 baseline and the incremental lineage selected by
 * the last-good daily generation. Raw API documents remain inside this
 * server-side scan; callers receive counts and a fail-closed capability gate.
 */
export async function assessDnaOpenLabCombinedHistoryPerformanceEvidence(input: {
  ownerId: string;
  bucketName: string;
  baselineAuthority: DnaOpenLabP5FinishedHistoryAuthority;
  baseline: DnaOpenLabP5FinishedHistoryReadPort;
  baselineIndex?: DnaOpenLabCompactPopulationBaseline;
  history: DnaOpenLabCombinedFinishedHistory;
  storage: ReadableObjectStorage;
  readBudget: DnaOpenLabHistoryReadBudgetAuthorization;
  canonicalPurpose?: "performance_evidence" | "population_inventory";
  onCanonicalRaceDocument?: (document: CanonicalRaceDocumentMetadata) => void;
}): Promise<DnaOpenLabCombinedHistoryPerformanceEvidenceAssessment> {
  const bucketName = safeText(input.bucketName, "bucketName");
  const prefix = ownerPrefix(input.ownerId);
  const maximumClassBOperations = nonNegativeInteger(
    input.readBudget.maximumClassBOperations,
    "read budget maximumClassBOperations",
  );
  if (
    input.readBudget.paidUsageAllowed !== false ||
    maximumClassBOperations > DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations
  ) {
    historyError("read budget is not bounded to the zero-cost policy");
  }
  let r2ClassBOperationsUsed = nonNegativeInteger(
    input.baselineIndex?.r2ClassBOperationsUsed ?? 0,
    "baseline index r2ClassBOperationsUsed",
  );
  if (r2ClassBOperationsUsed > maximumClassBOperations) {
    historyError("compact baseline exceeds the read budget");
  }
  function reserveClassBOperations(count: number): void {
    if (r2ClassBOperationsUsed + count > maximumClassBOperations) {
      historyError("read budget is exhausted before provider access");
    }
    r2ClassBOperationsUsed += count;
  }
  const privacy = await input.storage.readBucketPrivacy({ bucketName });
  if (
    privacy.publicAccessDisabled !== true ||
    privacy.r2DevDisabled !== true ||
    privacy.customDomainCount !== 0
  ) {
    historyError("evidence bucket is not private");
  }

  const baselineState = validateBaselineState(
    await input.baseline.load(),
    input.baselineAuthority,
  );
  const baselineReceipts =
    input.baselineIndex === undefined
      ? await loadBaselineReceipts({
          source: input.baseline,
          state: baselineState,
        })
      : Object.freeze([] as DnaOpenLabP5FirstBackfillDurableReceipt[]);
  if (
    input.baselineIndex !== undefined &&
    (input.baselineIndex.baselineReceiptCount !==
      baselineState.logicalRequestCount ||
      input.baselineIndex.baselineFinishedRaceReceiptCount < 0 ||
      input.baselineIndex.baselineFinishedRaceReceiptCount >
        baselineState.logicalRequestCount ||
      input.baselineIndex.baselineIdentityOmissionObservationCount !==
        baselineState.omittedIdentityObservationCount)
  ) {
    historyError("compact baseline authority disagrees with immutable P5");
  }

  const endpointEvidence = new Map<string, string>();
  const raceIds = new Set<string>();
  const preferredDocuments = new Map<string, DnaRaceDocument>();
  const compactCanonicalDocuments = new Map<
    string,
    CanonicalRaceDocumentMetadata
  >();
  let duplicateRaceEvidenceCount = 0;
  let conflictingRaceEvidenceCount = 0;
  let baselineFinishedRaceReceiptCount = 0;
  let baselineIdentityOmissionObservationCount = 0;
  let quarantinedIdentityObservationCount =
    baselineState.omittedIdentityObservationCount;
  const adaptDocument =
    input.canonicalPurpose === "population_inventory"
      ? adaptDnaRaceDocumentPopulationInventory
      : adaptDnaRaceDocument;

  function acceptCanonicalDocument(
    canonical: CanonicalRaceDocumentMetadata,
    digest: string,
    endpoint: "races.finished" | "races.docs",
  ): void {
    if (
      canonical.sourceType !== "race_document" ||
      canonical.sourceRaceId.trim() === "" ||
      !SHA_256_PATTERN.test(digest)
    ) {
      historyError("canonical Race document authority is invalid");
    }
    const sourceRaceId = canonical.sourceRaceId;
    const evidenceKey = `${endpoint}\u0000${sourceRaceId}`;
    const previous = endpointEvidence.get(evidenceKey);
    if (previous === digest) {
      duplicateRaceEvidenceCount += 1;
      return;
    }
    if (previous !== undefined) {
      conflictingRaceEvidenceCount += 1;
      return;
    }
    endpointEvidence.set(evidenceKey, digest);
    raceIds.add(sourceRaceId);
    if (
      endpoint === "races.docs" ||
      (!preferredDocuments.has(sourceRaceId) &&
        !compactCanonicalDocuments.has(sourceRaceId))
    ) {
      compactCanonicalDocuments.set(sourceRaceId, canonical);
    }
  }

  function acceptDocument(
    raw: DnaRaceDocument,
    observedAt: string,
    endpoint: "races.finished" | "races.docs",
    source: "baseline" | "incremental",
  ): void {
    const adapted = (() => {
      try {
        return adaptDocument({ raw, observedAt, endpoint });
      } catch (error) {
        if (
          source === "baseline" &&
          error instanceof DnaRaceDocumentAdaptationProcessingError &&
          error.diagnostic === "race_document_adaptation_identity_unavailable"
        ) {
          baselineIdentityOmissionObservationCount += 1;
          if (
            baselineIdentityOmissionObservationCount >
            baselineState.omittedIdentityObservationCount
          ) {
            historyError(
              "immutable P5 identity omissions exceed baseline authority",
            );
          }
          return null;
        }
        throw error;
      }
    })();
    if (adapted === null) return;
    const sourceRaceId = raceId(raw);
    const digest = dnaOpenLabRawEvidenceSha256(raw);
    if (
      adapted.canonical.sourceRaceId !== sourceRaceId ||
      adapted.rawEvidenceSha256 !== digest
    ) {
      historyError("canonical Race document identity drifted");
    }
    const evidenceKey = `${endpoint}\u0000${sourceRaceId}`;
    const previous = endpointEvidence.get(evidenceKey);
    if (previous === digest) {
      duplicateRaceEvidenceCount += 1;
      return;
    }
    if (previous !== undefined) {
      conflictingRaceEvidenceCount += 1;
      return;
    }
    endpointEvidence.set(evidenceKey, digest);
    raceIds.add(sourceRaceId);
    if (
      endpoint === "races.docs" ||
      (!preferredDocuments.has(sourceRaceId) &&
        !compactCanonicalDocuments.has(sourceRaceId))
    ) {
      preferredDocuments.set(sourceRaceId, raw);
      compactCanonicalDocuments.delete(sourceRaceId);
    }
  }

  if (input.baselineIndex !== undefined) {
    baselineFinishedRaceReceiptCount =
      input.baselineIndex.baselineFinishedRaceReceiptCount;
    baselineIdentityOmissionObservationCount =
      input.baselineIndex.baselineIdentityOmissionObservationCount;
    const seenCompactRaceIds = new Set<string>();
    for (const document of input.baselineIndex.documents) {
      if (
        document.canonical.sourceRaceId !== document.sourceRaceId ||
        seenCompactRaceIds.has(document.sourceRaceId)
      ) {
        historyError(
          "compact baseline contains invalid or duplicate Race identity",
        );
      }
      seenCompactRaceIds.add(document.sourceRaceId);
      acceptCanonicalDocument(
        document.canonical,
        document.rawEvidenceSha256,
        document.endpoint,
      );
    }
  } else {
    const baselineFinishedRaceReceipts = baselineReceipts.filter(
      (receipt) => receipt.family === "finished_races",
    );
    baselineFinishedRaceReceiptCount = baselineFinishedRaceReceipts.length;
    for (
      let start = 0;
      start < baselineFinishedRaceReceipts.length;
      start += BASELINE_EVIDENCE_READ_CONCURRENCY
    ) {
      const receiptBatch = baselineFinishedRaceReceipts.slice(
        start,
        start + BASELINE_EVIDENCE_READ_CONCURRENCY,
      );
      for (let index = 0; index < receiptBatch.length; index += 1) {
        reserveClassBOperations(2);
      }
      const evidenceBatch = await Promise.all(
        receiptBatch.map((receipt) =>
          input.baseline.readEvidence(receipt.requestOrdinal, receipt),
        ),
      );
      for (const [index, receipt] of receiptBatch.entries()) {
        const evidence = validateBaselineEvidence({
          receipt,
          evidence: evidenceBatch[index] ?? null,
        });
        if (
          evidence.endpoint !== "races.finished" &&
          evidence.endpoint !== "races.docs"
        ) {
          historyError("P5 finished-race receipt has an unexpected endpoint");
        }
        const documents = raceDocuments(
          evidence.response.result,
          "P5 Race response",
        );
        if (
          evidence.endpoint === "races.finished" &&
          documents.length === DNA_FINISHED_RACE_WINDOW_LIMIT
        ) {
          continue;
        }
        for (const raw of documents) {
          acceptDocument(
            raw,
            evidence.observedAt,
            evidence.endpoint,
            "baseline",
          );
        }
      }
    }
  }
  if (
    baselineIdentityOmissionObservationCount !==
    baselineState.omittedIdentityObservationCount
  ) {
    historyError(
      "immutable P5 identity omissions do not reconcile to baseline authority",
    );
  }

  let incrementalWindowCount = 0;
  let incrementalDocumentReferenceCount = 0;
  for (const cycle of input.history.cycles) {
    for (const receipt of cycle.receipts) {
      incrementalWindowCount += 1;
      reserveClassBOperations(2);
      const head = await input.storage.headObject({
        bucketName,
        key: receipt.manifestObjectKey,
      });
      if (
        head.status !== "ready" ||
        head.contentType !== JSON_CONTENT_TYPE ||
        head.byteLength !== receipt.manifestByteLength ||
        head.checksumSha256 !== receipt.manifestBodySha256 ||
        metadata(head.metadata, "dna-source") !== "dna_open_lab" ||
        metadata(head.metadata, "dna-version") !== "v1" ||
        metadata(head.metadata, "dna-endpoint") !== "races.finished" ||
        metadata(head.metadata, "dna-owner-sha256") !== prefix ||
        metadata(head.metadata, "dna-window-key") !== receipt.windowKey ||
        metadata(head.metadata, "dna-content-sha256") !==
          receipt.contentSha256 ||
        metadata(head.metadata, "dna-document-count") !==
          String(receipt.documentCount)
      ) {
        historyError("incremental manifest conflicts with its durable receipt");
      }
      const manifestBytes = await exactObjectBody({
        storage: input.storage,
        bucketName,
        key: receipt.manifestObjectKey,
        byteLength: receipt.manifestByteLength,
      });
      const decodedManifest = new TextDecoder("utf-8", { fatal: true }).decode(
        manifestBytes,
      );
      if (sha256Text(decodedManifest) !== receipt.manifestBodySha256) {
        historyError("incremental manifest checksum disagrees");
      }
      const parsedManifest = parsedJson(manifestBytes);
      if (canonicalJson(parsedManifest) !== decodedManifest) {
        historyError("incremental manifest is not canonical JSON");
      }
      const value = manifest(parsedManifest);
      const discoveredIds = raceDocuments(
        value.discoveredRaces,
        "manifest discovered Races",
      ).map(raceId);
      if (
        value.windowKey !== receipt.windowKey ||
        value.contentSha256 !== receipt.contentSha256 ||
        value.window.startTime !== receipt.windowStartAt ||
        value.window.endTime !== receipt.windowEndAt ||
        value.raceDocumentObjects.length !== receipt.documentCount ||
        discoveredIds.length !== receipt.documentCount ||
        new Set(
          value.raceDocumentObjects.map(({ sourceRaceId }) => sourceRaceId),
        ).size !== value.raceDocumentObjects.length ||
        [...discoveredIds].sort().join("\u0000") !==
          value.raceDocumentObjects
            .map(({ sourceRaceId }) => sourceRaceId)
            .sort()
            .join("\u0000")
      ) {
        historyError("incremental manifest contents disagree with publication");
      }
      for (const quarantine of value.identityConflictQuarantineObjects) {
        reserveClassBOperations(2);
        const expectedKey = [
          "dna-open-lab",
          "v1",
          prefix,
          "races",
          "quarantine",
          "unresolved-identity",
          `${quarantine.evidenceLocatorSha256}.json`,
        ].join("/");
        if (quarantine.objectKey !== expectedKey) {
          historyError("incremental quarantine object key is invalid");
        }
        const quarantineHead = await input.storage.headObject({
          bucketName,
          key: quarantine.objectKey,
        });
        if (
          quarantineHead.status !== "ready" ||
          quarantineHead.contentType !== JSON_CONTENT_TYPE ||
          quarantineHead.byteLength !== quarantine.byteLength ||
          quarantineHead.checksumSha256 !== quarantine.bodySha256 ||
          metadata(quarantineHead.metadata, "dna-owner-sha256") !== prefix ||
          metadata(quarantineHead.metadata, "dna-authority") !==
            "unresolved_source_identity" ||
          metadata(quarantineHead.metadata, "dna-evidence-locator-sha256") !==
            quarantine.evidenceLocatorSha256 ||
          metadata(quarantineHead.metadata, "dna-raw-sha256") !==
            quarantine.rawEvidenceSha256 ||
          metadata(quarantineHead.metadata, "dna-canonical-publishable") !==
            "false" ||
          metadata(quarantineHead.metadata, "dna-last-good-publishable") !==
            "false"
        ) {
          historyError("incremental quarantine object is inconsistent");
        }
        const quarantineBytes = await exactObjectBody({
          storage: input.storage,
          bucketName,
          key: quarantine.objectKey,
          byteLength: quarantine.byteLength,
        });
        if (
          sha256Text(
            new TextDecoder("utf-8", { fatal: true }).decode(quarantineBytes),
          ) !== quarantine.bodySha256
        ) {
          historyError("incremental quarantine object checksum disagrees");
        }
        quarantinedIdentityObservationCount += 1;
      }
      for (const reference of value.raceDocumentObjects) {
        incrementalDocumentReferenceCount += 1;
        reserveClassBOperations(2);
        const expectedKey = [
          "dna-open-lab",
          "v1",
          prefix,
          "races",
          "docs",
          raceIdentityHash(reference.sourceRaceId),
          `${reference.rawEvidenceSha256}.json`,
        ].join("/");
        if (reference.objectKey !== expectedKey) {
          historyError("incremental Race document object key is invalid");
        }
        const raceHead = await input.storage.headObject({
          bucketName,
          key: reference.objectKey,
        });
        if (
          raceHead.status !== "ready" ||
          raceHead.contentType !== JSON_CONTENT_TYPE ||
          raceHead.byteLength < 1 ||
          raceHead.byteLength > MAXIMUM_OBJECT_BYTES ||
          raceHead.checksumSha256 !== reference.rawEvidenceSha256 ||
          metadata(raceHead.metadata, "dna-source") !== "dna_open_lab" ||
          metadata(raceHead.metadata, "dna-version") !== "v1" ||
          metadata(raceHead.metadata, "dna-endpoint") !== "races.docs" ||
          metadata(raceHead.metadata, "dna-owner-sha256") !== prefix ||
          metadata(raceHead.metadata, "dna-race-id-sha256") !==
            raceIdentityHash(reference.sourceRaceId) ||
          metadata(raceHead.metadata, "dna-raw-sha256") !==
            reference.rawEvidenceSha256
        ) {
          historyError("incremental Race document conflicts with its manifest");
        }
        const raceBytes = await exactObjectBody({
          storage: input.storage,
          bucketName,
          key: reference.objectKey,
          byteLength: raceHead.byteLength,
        });
        const raw = record(
          parsedJson(raceBytes),
          "incremental Race document",
        ) as DnaRaceDocument;
        if (
          sha256Text(canonicalJson(raw)) !== reference.rawEvidenceSha256 ||
          raceId(raw) !== reference.sourceRaceId
        ) {
          historyError(
            "incremental Race document checksum or identity disagrees",
          );
        }
        acceptDocument(raw, receipt.windowEndAt, "races.docs", "incremental");
      }
    }
  }

  if (
    incrementalWindowCount !== input.history.receiptCount ||
    incrementalDocumentReferenceCount !== input.history.documentCount ||
    conflictingRaceEvidenceCount !== 0
  ) {
    historyError("combined finished-history evidence is inconsistent");
  }

  let bikeRaceCount = 0;
  let bikeRaceWithFormatCount = 0;
  let bikeRaceWithTrackSourceValueCount = 0;
  for (const sourceRaceId of raceIds) {
    const raw = preferredDocuments.get(sourceRaceId);
    const canonical =
      raw === undefined
        ? compactCanonicalDocuments.get(sourceRaceId)
        : adaptDocument({
            raw,
            observedAt: "2000-01-01T00:00:00.000Z",
            endpoint: "races.docs",
          }).canonical;
    if (canonical === undefined) {
      historyError("preferred Race document is unavailable");
    }
    input.onCanonicalRaceDocument?.(canonical);
    if (canonical.mode !== "bike") continue;
    bikeRaceCount += 1;
    if (canonical.format !== undefined && canonical.format !== null) {
      bikeRaceWithFormatCount += 1;
    }
    if (canonical.trackSourceValue !== undefined) {
      bikeRaceWithTrackSourceValueCount += 1;
    }
  }

  return Object.freeze({
    authority: "complete_serving_generation_combined_finished_history",
    refreshCycleId: input.history.refreshCycleId,
    currentStateGenerationId: input.history.currentStateGenerationId,
    baselineReceiptCount:
      input.baselineIndex?.baselineReceiptCount ?? baselineReceipts.length,
    baselineFinishedRaceReceiptCount,
    incrementalWindowCount,
    incrementalDocumentReferenceCount,
    quarantinedIdentityObservationCount,
    r2ClassBOperationsUsed,
    uniqueRaceCount: raceIds.size,
    duplicateRaceEvidenceCount,
    conflictingRaceEvidenceCount,
    bikeRaceCount,
    bikeRaceWithFormatCount,
    bikeRaceWithTrackSourceValueCount,
    exactTypeAndDistanceElapsedObservationCount: 0,
    performanceSelectionStatus:
      "held_without_exact_format_elapsed_time_evidence",
    unavailableAuthorities: Object.freeze([
      "authoritative_exact_distance",
      "authoritative_elapsed_time",
      "authoritative_finish_position",
    ] as const),
    rawEvidenceExposed: false,
    persistentWritePerformed: false,
    paidUsageAllowed: false,
  });
}
