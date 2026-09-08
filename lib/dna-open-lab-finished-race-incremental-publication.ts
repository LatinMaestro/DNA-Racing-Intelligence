import { createHash } from "node:crypto";

import { validateDnaFinishedRaceWindowPublicationReceipt } from "./dna-open-lab-finished-race-backfill";
import {
  validateDnaFinishedRaceIncrementalCycle,
  type DnaFinishedRaceIncrementalCycle,
} from "./dna-open-lab-finished-race-incremental-cycle";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export const DNA_FINISHED_RACE_INCREMENTAL_PUBLICATION_VERSION = 1 as const;

export type DnaFinishedRaceIncrementalWindowReceipt = Readonly<{
  cycleId: string;
  firstAttemptNumber: number;
  windowStartAt: string;
  windowEndAt: string;
  windowKey: string;
  contentSha256: string;
  documentCount: number;
  manifestObjectKey: string;
  manifestBodySha256: string;
  manifestByteLength: number;
}>;

export type DnaFinishedRaceIncrementalPublicationCandidate = Readonly<{
  version: typeof DNA_FINISHED_RACE_INCREMENTAL_PUBLICATION_VERSION;
  cycleId: string;
  previousPublishedCycleId: string | null;
  attemptNumber: number;
  lowerBoundAt: string;
  upperBoundAt: string;
  receiptCount: number;
  documentCount: number;
  manifestByteLength: number;
  receiptSetSha256: string;
  validatedAt: string;
}>;

export type DnaFinishedRaceIncrementalPublication =
  DnaFinishedRaceIncrementalPublicationCandidate &
    Readonly<{ publishedAt: string }>;

export type DnaFinishedRaceIncrementalPublicationRepository = Readonly<{
  loadReceiptSet: (input: {
    cycleId: string;
    attemptNumber: number;
  }) => Promise<readonly DnaFinishedRaceIncrementalWindowReceipt[]>;
  publish: (input: {
    candidate: DnaFinishedRaceIncrementalPublicationCandidate;
    publishedAt: string;
  }) => Promise<DnaFinishedRaceIncrementalPublication>;
}>;

function publicationError(message: string): never {
  throw new Error(`DNA finished-race incremental publication: ${message}`);
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    publicationError(`${field} must be a SHA-256 value`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) publicationError(`${field} is invalid`);
  return new Date(parsed).toISOString();
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    publicationError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  const normalized = nonNegativeInteger(value, field);
  if (normalized < 1) publicationError(`${field} must be positive`);
  return normalized;
}

function normalizeReceipt(
  value: DnaFinishedRaceIncrementalWindowReceipt,
  cycle: DnaFinishedRaceIncrementalCycle,
): DnaFinishedRaceIncrementalWindowReceipt {
  const cycleId = sha256(value.cycleId, "receipt.cycleId");
  if (cycleId !== cycle.cycleId) {
    publicationError("receipt belongs to a different cycle");
  }
  const firstAttemptNumber = positiveInteger(
    value.firstAttemptNumber,
    "receipt.firstAttemptNumber",
  );
  if (firstAttemptNumber > cycle.attemptNumber) {
    publicationError("receipt attempt follows the completed attempt");
  }
  const windowStartAt = timestamp(value.windowStartAt, "receipt.windowStartAt");
  const windowEndAt = timestamp(value.windowEndAt, "receipt.windowEndAt");
  if (Date.parse(windowStartAt) >= Date.parse(windowEndAt)) {
    publicationError("receipt window bounds are invalid");
  }
  const receipt = validateDnaFinishedRaceWindowPublicationReceipt({
    windowKey: sha256(value.windowKey, "receipt.windowKey"),
    contentSha256: sha256(value.contentSha256, "receipt.contentSha256"),
    documentCount: nonNegativeInteger(
      value.documentCount,
      "receipt.documentCount",
    ),
    manifestObjectKey: value.manifestObjectKey,
    manifestBodySha256: sha256(
      value.manifestBodySha256,
      "receipt.manifestBodySha256",
    ),
    manifestByteLength: positiveInteger(
      value.manifestByteLength,
      "receipt.manifestByteLength",
    ),
  });
  return Object.freeze({
    cycleId,
    firstAttemptNumber,
    windowStartAt,
    windowEndAt,
    ...receipt,
  });
}

function receiptHashLine(
  receipt: DnaFinishedRaceIncrementalWindowReceipt,
): string {
  return [
    String(Date.parse(receipt.windowStartAt)),
    String(Date.parse(receipt.windowEndAt)),
    receipt.windowKey,
    receipt.contentSha256,
    String(receipt.documentCount),
    `${Buffer.byteLength(receipt.manifestObjectKey, "utf8")}:${receipt.manifestObjectKey}`,
    receipt.manifestBodySha256,
    String(receipt.manifestByteLength),
  ].join("|");
}

export function validateDnaFinishedRaceIncrementalReceiptSet(input: {
  cycle: DnaFinishedRaceIncrementalCycle;
  receipts: readonly DnaFinishedRaceIncrementalWindowReceipt[];
  validatedAt: string;
}): DnaFinishedRaceIncrementalPublicationCandidate {
  const cycle = validateDnaFinishedRaceIncrementalCycle(input.cycle);
  if (cycle.status !== "complete" || cycle.completion === null) {
    publicationError("cycle is not complete");
  }
  const validatedAt = timestamp(input.validatedAt, "validatedAt");
  if (Date.parse(validatedAt) < Date.parse(cycle.completion.completedAt)) {
    publicationError("validation precedes collection completion");
  }
  const receipts = input.receipts
    .map((value) => normalizeReceipt(value, cycle))
    .sort(
      (left, right) =>
        Date.parse(left.windowStartAt) - Date.parse(right.windowStartAt) ||
        Date.parse(left.windowEndAt) - Date.parse(right.windowEndAt) ||
        left.windowKey.localeCompare(right.windowKey),
    );
  if (
    receipts.length < 1 ||
    receipts.length !== cycle.checkpoint.completedWindowCount
  ) {
    publicationError("receipt count does not match the completed checkpoint");
  }
  if (
    new Set(receipts.map((value) => value.windowKey)).size !==
      receipts.length ||
    new Set(receipts.map((value) => value.manifestObjectKey)).size !==
      receipts.length
  ) {
    publicationError("receipt set repeats immutable evidence identity");
  }
  let boundary = cycle.lowerBoundAt;
  for (const receipt of receipts) {
    if (receipt.windowStartAt !== boundary) {
      publicationError("receipt windows are not a contiguous exact cover");
    }
    boundary = receipt.windowEndAt;
  }
  if (boundary !== cycle.upperBoundAt) {
    publicationError("receipt windows do not reach the cycle upper bound");
  }
  const documentCount = receipts.reduce(
    (total, value) => total + value.documentCount,
    0,
  );
  if (documentCount !== cycle.checkpoint.publishedWindowDocumentCount) {
    publicationError("document count does not match the completed checkpoint");
  }
  const manifestByteLength = receipts.reduce(
    (total, value) => total + value.manifestByteLength,
    0,
  );
  if (!Number.isSafeInteger(manifestByteLength)) {
    publicationError("manifest byte total exceeds safe integer authority");
  }
  const receiptSetSha256 = createHash("sha256")
    .update(receipts.map(receiptHashLine).join("\n"), "utf8")
    .digest("hex");
  return Object.freeze({
    version: DNA_FINISHED_RACE_INCREMENTAL_PUBLICATION_VERSION,
    cycleId: cycle.cycleId,
    previousPublishedCycleId: cycle.previousCompletedCycleId,
    attemptNumber: cycle.attemptNumber,
    lowerBoundAt: cycle.lowerBoundAt,
    upperBoundAt: cycle.upperBoundAt,
    receiptCount: receipts.length,
    documentCount,
    manifestByteLength,
    receiptSetSha256,
    validatedAt,
  });
}

/**
 * Validates every immutable window receipt before crossing the single database
 * publication boundary. The repository must re-check the same receipt-set hash
 * while holding the owner publication lock so validation cannot race a change.
 */
export async function publishDnaFinishedRaceIncrementalCycle(input: {
  cycle: DnaFinishedRaceIncrementalCycle;
  repository: DnaFinishedRaceIncrementalPublicationRepository;
  validatedAt: string;
  publishedAt: string;
}): Promise<DnaFinishedRaceIncrementalPublication> {
  const publishedAt = timestamp(input.publishedAt, "publishedAt");
  const receipts = await input.repository.loadReceiptSet({
    cycleId: input.cycle.cycleId,
    attemptNumber: input.cycle.attemptNumber,
  });
  const candidate = validateDnaFinishedRaceIncrementalReceiptSet({
    cycle: input.cycle,
    receipts,
    validatedAt: input.validatedAt,
  });
  if (Date.parse(publishedAt) < Date.parse(candidate.validatedAt)) {
    publicationError("publication precedes receipt-set validation");
  }
  const published = await input.repository.publish({ candidate, publishedAt });
  for (const field of [
    "version",
    "cycleId",
    "previousPublishedCycleId",
    "attemptNumber",
    "lowerBoundAt",
    "upperBoundAt",
    "receiptCount",
    "documentCount",
    "manifestByteLength",
    "receiptSetSha256",
    "validatedAt",
  ] as const) {
    if (published[field] !== candidate[field]) {
      publicationError(`stored publication ${field} drifted`);
    }
  }
  if (timestamp(published.publishedAt, "stored.publishedAt") !== publishedAt) {
    publicationError("stored publication time drifted");
  }
  return Object.freeze({ ...published, publishedAt });
}
