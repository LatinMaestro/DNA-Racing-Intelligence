import { createHash } from "node:crypto";

import type { DnaOpenLabP5FirstBackfillApprovalPacket } from "./dna-open-lab-p5-first-backfill-approval";
import {
  createDnaOpenLabP5FirstBackfillR2EvidenceWriter,
  type DnaOpenLabP5FirstBackfillEvidenceReceipt,
  type DnaOpenLabP5FirstBackfillEvidenceWriter,
  type DnaOpenLabP5FirstBackfillR2EvidenceStoragePort,
} from "./dna-open-lab-p5-first-backfill-r2-evidence";
import type { DnaOpenLabP5FirstBackfillSourceFamily } from "./dna-open-lab-p5-first-backfill-measurement";
import type { DnaOpenLabResponse } from "./dna-open-lab-v1-client";
import type {
  DnaOpenLabP5FirstBackfillDurableReceipt,
  DnaOpenLabP5FirstBackfillLedger,
  DnaOpenLabP5FirstBackfillLedgerState,
} from "./neon-dna-open-lab-p5-first-backfill-ledger";

const RECEIPT_PAGE_SIZE = 500;

export type DnaOpenLabP5FirstBackfillPersistenceSnapshot = Readonly<{
  status: "running" | "complete";
  revision: string;
  nextRequestOrdinal: number;
  logicalRequestCount: number;
  retainedR2Bytes: number;
  omittedIdentityObservationCount: number;
  completionSha256: string | null;
}>;

export type DnaOpenLabP5FirstBackfillPersistenceCoordinator = Readonly<{
  initialize: () => Promise<DnaOpenLabP5FirstBackfillPersistenceSnapshot>;
  record: (input: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    endpoint: string;
    request: unknown;
    response: DnaOpenLabResponse<unknown>;
    observedAt: string;
    omittedIdentityObservationCount?: 0 | 1;
  }) => Promise<DnaOpenLabP5FirstBackfillPersistenceSnapshot>;
  complete: () => Promise<DnaOpenLabP5FirstBackfillPersistenceSnapshot>;
  snapshot: () => DnaOpenLabP5FirstBackfillPersistenceSnapshot | null;
}>;

type EvidenceWriterFactory = (input: {
  ownerId: string;
  bucketName: string;
  storage: DnaOpenLabP5FirstBackfillR2EvidenceStoragePort;
  approvalPacket: DnaOpenLabP5FirstBackfillApprovalPacket;
  priorReceipts: readonly DnaOpenLabP5FirstBackfillEvidenceReceipt[];
}) => DnaOpenLabP5FirstBackfillEvidenceWriter;

function coordinatorError(message: string): never {
  throw new Error(`DNA Open Lab P5 first backfill persistence: ${message}`);
}

function snapshot(
  state: DnaOpenLabP5FirstBackfillLedgerState,
): DnaOpenLabP5FirstBackfillPersistenceSnapshot {
  return Object.freeze({ ...state });
}

function nextRevision(value: string): string {
  try {
    return (BigInt(value) + 1n).toString();
  } catch {
    return coordinatorError("ledger revision is invalid");
  }
}

function receiptDigest(
  receipts: readonly DnaOpenLabP5FirstBackfillDurableReceipt[],
): string {
  const hash = createHash("sha256");
  hash.update("dna-open-lab-p5-first-backfill-completion-v1\u0000", "utf8");
  for (const receipt of receipts) {
    hash.update(
      JSON.stringify([
        receipt.requestOrdinal,
        receipt.family,
        receipt.observedAt,
        receipt.contentSha256,
        receipt.byteLength,
        receipt.evidenceObjectKey,
        receipt.omittedIdentityObservationCount,
        receipt.quarantineBound,
      ]),
      "utf8",
    );
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

function verifyRehydratedState(input: {
  state: DnaOpenLabP5FirstBackfillLedgerState;
  receipts: readonly DnaOpenLabP5FirstBackfillDurableReceipt[];
  writer: DnaOpenLabP5FirstBackfillEvidenceWriter;
}): void {
  let bytes = 0;
  let omissions = 0;
  for (let index = 0; index < input.receipts.length; index += 1) {
    const receipt = input.receipts[index];
    if (receipt === undefined) {
      coordinatorError("durable receipt prefix contains a gap");
    }
    if (receipt.requestOrdinal !== index + 1) {
      coordinatorError("durable receipts are not a contiguous prefix");
    }
    bytes += receipt.byteLength;
    omissions += receipt.omittedIdentityObservationCount;
    if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(omissions)) {
      coordinatorError("durable receipt accounting overflowed");
    }
  }
  const usage = input.writer.usage();
  if (
    input.state.logicalRequestCount !== input.receipts.length ||
    input.state.nextRequestOrdinal !== input.receipts.length + 1 ||
    input.state.retainedR2Bytes !== bytes ||
    input.state.omittedIdentityObservationCount !== omissions ||
    usage.logicalRequestCount !== input.receipts.length ||
    usage.retainedR2Bytes !== bytes
  ) {
    coordinatorError("Neon and immutable R2 receipt authority disagree");
  }
  if (
    input.state.status === "complete" &&
    input.state.completionSha256 !== receiptDigest(input.receipts)
  ) {
    coordinatorError("completed receipt checksum disagrees");
  }
}

/**
 * Couples request-level immutable evidence to the compact Neon checkpoint.
 * R2 is intentionally written first. A crash before the Neon transaction can
 * replay the exact ordinal against the immutable object; conflicting bytes are
 * rejected by the evidence writer and committed usage is never double-counted.
 */
export function createDnaOpenLabP5FirstBackfillPersistenceCoordinator(input: {
  ownerId: string;
  bucketName: string;
  storage: DnaOpenLabP5FirstBackfillR2EvidenceStoragePort;
  approvalPacket: DnaOpenLabP5FirstBackfillApprovalPacket;
  ledger: DnaOpenLabP5FirstBackfillLedger;
  evidenceWriterFactory?: EvidenceWriterFactory;
}): DnaOpenLabP5FirstBackfillPersistenceCoordinator {
  const evidenceWriterFactory =
    input.evidenceWriterFactory ??
    createDnaOpenLabP5FirstBackfillR2EvidenceWriter;
  let state: DnaOpenLabP5FirstBackfillLedgerState | null = null;
  let writer: DnaOpenLabP5FirstBackfillEvidenceWriter | null = null;
  let receipts: DnaOpenLabP5FirstBackfillDurableReceipt[] = [];

  async function initialize(): Promise<DnaOpenLabP5FirstBackfillPersistenceSnapshot> {
    if (state !== null) return snapshot(state);
    const initialized = await input.ledger.initialize();
    const loaded: DnaOpenLabP5FirstBackfillDurableReceipt[] = [];
    while (loaded.length < initialized.logicalRequestCount) {
      const page = await input.ledger.loadReceipts({
        afterRequestOrdinal: loaded.length,
        limit: RECEIPT_PAGE_SIZE,
      });
      if (page.length < 1) {
        coordinatorError("durable receipt prefix ended before its checkpoint");
      }
      loaded.push(...page);
      if (loaded.length > initialized.logicalRequestCount) {
        coordinatorError("durable receipts exceed their checkpoint");
      }
    }
    const hydratedWriter = evidenceWriterFactory({
      ownerId: input.ownerId,
      bucketName: input.bucketName,
      storage: input.storage,
      approvalPacket: input.approvalPacket,
      priorReceipts: loaded,
    });
    verifyRehydratedState({
      state: initialized,
      receipts: loaded,
      writer: hydratedWriter,
    });
    state = initialized;
    writer = hydratedWriter;
    receipts = loaded;
    return snapshot(state);
  }

  async function record(value: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    endpoint: string;
    request: unknown;
    response: DnaOpenLabResponse<unknown>;
    observedAt: string;
    omittedIdentityObservationCount?: 0 | 1;
  }): Promise<DnaOpenLabP5FirstBackfillPersistenceSnapshot> {
    if (state === null || writer === null) {
      coordinatorError("initialize must complete before recording");
    }
    if (state.status !== "running") {
      coordinatorError("completed authority cannot record another request");
    }
    const omitted = value.omittedIdentityObservationCount ?? 0;
    if (
      (omitted !== 0 && omitted !== 1) ||
      (omitted === 1 && value.family !== "finished_races")
    ) {
      coordinatorError("identity omission is outside its authority");
    }
    const previous = state;
    const receipt = await writer.write({
      family: value.family,
      requestOrdinal: previous.nextRequestOrdinal,
      endpoint: value.endpoint,
      request: value.request,
      response: value.response,
      observedAt: value.observedAt,
    });
    const advanced = await input.ledger.record({
      expectedRevision: previous.revision,
      receipt,
      omittedIdentityObservationCount: omitted,
    });
    if (
      advanced.status !== "running" ||
      advanced.revision !== nextRevision(previous.revision) ||
      advanced.logicalRequestCount !== previous.logicalRequestCount + 1 ||
      advanced.nextRequestOrdinal !== previous.nextRequestOrdinal + 1 ||
      advanced.retainedR2Bytes !==
        previous.retainedR2Bytes + receipt.byteLength ||
      advanced.omittedIdentityObservationCount !==
        previous.omittedIdentityObservationCount + omitted
    ) {
      coordinatorError("Neon did not atomically commit the exact R2 receipt");
    }
    receipts.push(
      Object.freeze({
        ...receipt,
        omittedIdentityObservationCount: omitted,
        quarantineBound: omitted === 1,
      }),
    );
    state = advanced;
    return snapshot(state);
  }

  async function complete(): Promise<DnaOpenLabP5FirstBackfillPersistenceSnapshot> {
    if (state === null || writer === null) {
      coordinatorError("initialize must complete before completion");
    }
    const completionSha256 = receiptDigest(receipts);
    if (state.status === "complete") {
      if (state.completionSha256 !== completionSha256) {
        coordinatorError("completed authority checksum drifted");
      }
      return snapshot(state);
    }
    const usage = writer.usage();
    if (
      usage.logicalRequestCount !== usage.logicalRequestLimit ||
      usage.logicalRequestCount !== receipts.length ||
      usage.retainedR2Bytes !== state.retainedR2Bytes ||
      state.omittedIdentityObservationCount !== 1
    ) {
      coordinatorError("approved complete-inventory bounds are not satisfied");
    }
    const completed = await input.ledger.complete({
      expectedRevision: state.revision,
      completionSha256,
    });
    if (
      completed.status !== "complete" ||
      completed.revision !== nextRevision(state.revision) ||
      completed.completionSha256 !== completionSha256 ||
      completed.logicalRequestCount !== state.logicalRequestCount ||
      completed.retainedR2Bytes !== state.retainedR2Bytes ||
      completed.omittedIdentityObservationCount !== 1
    ) {
      coordinatorError("Neon did not commit the exact completion authority");
    }
    state = completed;
    return snapshot(state);
  }

  return Object.freeze({
    initialize,
    record,
    complete,
    snapshot: () => (state === null ? null : snapshot(state)),
  });
}
