import { createHash } from "node:crypto";

import type { RaceMergeOutcomeEvidenceRow } from "./race-merge-outcome-ingestion-service";
import type {
  RaceMergeCoreOutcomeR2PreparedWrite,
  RaceMergeCoreOutcomeR2Receipt,
  RaceMergeCoreOutcomeR2Write,
} from "./race-merge-core-outcome-r2-store";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const MANIFEST_PAGE_LIMIT = 100;

export const RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_CORES = 100;
export const RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_BYTES = 64 * 1024 * 1024;
export const RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION = 1 as const;

export type RaceMergeCoreOutcomeR2GenerationAuthority = Readonly<{
  version: typeof RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION;
  generationId: string;
  cohortOrdinal: number;
  firstSourceCoreId: number;
  lastSourceCoreId: number;
  coreCount: number;
  uniqueOutcomeCount: number;
  sourceObservationCount: number;
  retainedR2Bytes: number;
  receiptSetSha256: string;
}>;

export type RaceMergeCoreOutcomeR2GenerationCheckpoint =
  RaceMergeCoreOutcomeR2GenerationAuthority &
    Readonly<{
      status: "writing" | "complete";
      registeredCoreCount: number;
      registeredUniqueOutcomeCount: number;
      registeredSourceObservationCount: number;
      registeredR2Bytes: number;
      lastRegisteredSourceCoreId: number | null;
      completedReceiptSetSha256: string | null;
      startedAt: string;
      updatedAt: string;
    }>;

export type RaceMergeCoreOutcomeR2Manifest = RaceMergeCoreOutcomeR2Receipt &
  Readonly<{ registeredAt: string }>;

export type RaceMergeCoreOutcomeR2GenerationRepository = Readonly<{
  begin: (
    ownerId: string,
    request: Readonly<{
      authority: RaceMergeCoreOutcomeR2GenerationAuthority;
      startedAt: string;
    }>,
  ) => Promise<RaceMergeCoreOutcomeR2GenerationCheckpoint>;
  registerCore: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      cohortOrdinal: number;
      receipt: RaceMergeCoreOutcomeR2Receipt;
      registeredAt: string;
    }>,
  ) => Promise<RaceMergeCoreOutcomeR2GenerationCheckpoint>;
  finalize: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      cohortOrdinal: number;
      receiptSetSha256: string;
      completedAt: string;
    }>,
  ) => Promise<RaceMergeCoreOutcomeR2GenerationCheckpoint>;
  listManifests: (
    ownerId: string,
    request: Readonly<{
      generationId: string;
      cohortOrdinal: number;
      afterSourceCoreId: number;
      limit: number;
    }>,
  ) => Promise<readonly RaceMergeCoreOutcomeR2Manifest[]>;
}>;

export type RaceMergeCoreOutcomeR2CapacityApproval = Readonly<{
  version: 1;
  generationId: string;
  cohortOrdinal: number;
  receiptSetSha256: string;
  retainedR2Bytes: number;
  measuredAt: string;
  validUntil: string;
  capacityAllowed: true;
  projectedPaidCostAud: 0;
}>;

export type RaceMergeCoreOutcomeR2CapacityGate = Readonly<{
  assertFreshCurrentCapacity: (
    authority: RaceMergeCoreOutcomeR2GenerationAuthority,
  ) => Promise<RaceMergeCoreOutcomeR2CapacityApproval>;
}>;

export type RaceMergeCoreOutcomeR2GenerationStore = Readonly<{
  prepare: (request: {
    generationId: string;
    sourceCoreId: number;
    observations: readonly RaceMergeOutcomeEvidenceRow[];
  }) => RaceMergeCoreOutcomeR2PreparedWrite;
  commit: (
    prepared: RaceMergeCoreOutcomeR2PreparedWrite,
  ) => Promise<RaceMergeCoreOutcomeR2Write>;
  read: (receipt: RaceMergeCoreOutcomeR2Receipt) => Promise<readonly unknown[]>;
}>;

export type RaceMergeCoreOutcomeR2GenerationResult = Readonly<{
  authority: RaceMergeCoreOutcomeR2GenerationAuthority;
  checkpointBefore: RaceMergeCoreOutcomeR2GenerationCheckpoint;
  checkpointAfter: RaceMergeCoreOutcomeR2GenerationCheckpoint;
  receipts: readonly RaceMergeCoreOutcomeR2Receipt[];
  storageStatuses: readonly ("created" | "existing")[];
  resumedRegisteredCoreCount: number;
  capacityMeasuredAt: string;
  dnaApiRequestPerformed: false;
  persistentWritePerformed: true;
  paidUsageAllowed: false;
}>;

function fail(message: string): never {
  throw new Error(`Race Merge Core outcome generation: ${message}`);
}

function identifier(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) fail(`${field} is invalid`);
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(`${field} is invalid`);
  }
  return value as number;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} is invalid`);
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${field} is invalid`);
  }
  return parsed.toISOString();
}

function receiptSetSha256(
  receipts: readonly RaceMergeCoreOutcomeR2Receipt[],
): string {
  const digest = createHash("sha256");
  for (const receipt of receipts) {
    digest.update(
      [
        receipt.version,
        receipt.generationId,
        receipt.sourceCoreId,
        receipt.objectKey,
        receipt.bodySha256,
        receipt.byteLength,
        receipt.uniqueOutcomeCount,
        receipt.sourceObservationCount,
        receipt.firstSourceRaceId,
        receipt.lastSourceRaceId,
      ].join("\u0000"),
    );
    digest.update("\n");
  }
  return digest.digest("hex");
}

function sameReceipt(
  left: RaceMergeCoreOutcomeR2Receipt,
  right: RaceMergeCoreOutcomeR2Receipt,
): boolean {
  return (
    left.version === right.version &&
    left.generationId === right.generationId &&
    left.sourceCoreId === right.sourceCoreId &&
    left.objectKey === right.objectKey &&
    left.bodySha256 === right.bodySha256 &&
    left.byteLength === right.byteLength &&
    left.uniqueOutcomeCount === right.uniqueOutcomeCount &&
    left.sourceObservationCount === right.sourceObservationCount &&
    left.firstSourceRaceId === right.firstSourceRaceId &&
    left.lastSourceRaceId === right.lastSourceRaceId
  );
}

function authorityFor(input: {
  generationId: string;
  cohortOrdinal: number;
  receipts: readonly RaceMergeCoreOutcomeR2Receipt[];
}): RaceMergeCoreOutcomeR2GenerationAuthority {
  const generationId = identifier(input.generationId, "generationId");
  const cohortOrdinal = positiveInteger(input.cohortOrdinal, "cohortOrdinal");
  if (
    input.receipts.length < 1 ||
    input.receipts.length > RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_CORES
  ) {
    fail("Core count is outside its bounded cohort");
  }
  input.receipts.forEach((receipt, index) => {
    if (
      receipt.generationId !== generationId ||
      (index > 0 &&
        receipt.sourceCoreId <= input.receipts[index - 1]!.sourceCoreId)
    ) {
      fail("prepared Core receipts are not a strict generation sequence");
    }
  });
  const sum = (
    field: "uniqueOutcomeCount" | "sourceObservationCount" | "byteLength",
  ) =>
    input.receipts.reduce((total, receipt) => {
      const next = total + receipt[field];
      if (!Number.isSafeInteger(next)) fail(`${field} total is invalid`);
      return next;
    }, 0);
  const retainedR2Bytes = sum("byteLength");
  if (retainedR2Bytes > RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_BYTES) {
    fail("prepared R2 bytes exceed the bounded cohort");
  }
  return Object.freeze({
    version: RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION,
    generationId,
    cohortOrdinal,
    firstSourceCoreId: input.receipts[0]!.sourceCoreId,
    lastSourceCoreId: input.receipts.at(-1)!.sourceCoreId,
    coreCount: input.receipts.length,
    uniqueOutcomeCount: sum("uniqueOutcomeCount"),
    sourceObservationCount: sum("sourceObservationCount"),
    retainedR2Bytes,
    receiptSetSha256: receiptSetSha256(input.receipts),
  });
}

function sameAuthority(
  left: RaceMergeCoreOutcomeR2GenerationAuthority,
  right: RaceMergeCoreOutcomeR2GenerationAuthority,
): boolean {
  return Object.keys(right).every(
    (key) =>
      left[key as keyof RaceMergeCoreOutcomeR2GenerationAuthority] ===
      right[key as keyof RaceMergeCoreOutcomeR2GenerationAuthority],
  );
}

function validateCheckpoint(input: {
  checkpoint: RaceMergeCoreOutcomeR2GenerationCheckpoint;
  authority: RaceMergeCoreOutcomeR2GenerationAuthority;
  expectedReceipts: readonly RaceMergeCoreOutcomeR2Receipt[];
  expectedStatus: "writing" | "complete";
}): void {
  const { checkpoint, authority, expectedReceipts, expectedStatus } = input;
  const registeredUniqueOutcomeCount = expectedReceipts.reduce(
    (total, receipt) => total + receipt.uniqueOutcomeCount,
    0,
  );
  const registeredSourceObservationCount = expectedReceipts.reduce(
    (total, receipt) => total + receipt.sourceObservationCount,
    0,
  );
  const registeredR2Bytes = expectedReceipts.reduce(
    (total, receipt) => total + receipt.byteLength,
    0,
  );
  if (
    !sameAuthority(checkpoint, authority) ||
    checkpoint.status !== expectedStatus ||
    checkpoint.registeredCoreCount !== expectedReceipts.length ||
    checkpoint.registeredUniqueOutcomeCount !== registeredUniqueOutcomeCount ||
    checkpoint.registeredSourceObservationCount !==
      registeredSourceObservationCount ||
    checkpoint.registeredR2Bytes !== registeredR2Bytes ||
    checkpoint.lastRegisteredSourceCoreId !==
      (expectedReceipts.at(-1)?.sourceCoreId ?? null) ||
    checkpoint.completedReceiptSetSha256 !==
      (expectedStatus === "complete" ? authority.receiptSetSha256 : null) ||
    Date.parse(checkpoint.updatedAt) < Date.parse(checkpoint.startedAt)
  ) {
    fail("durable checkpoint disagrees with registered receipts");
  }
}

async function manifests(input: {
  ownerId: string;
  authority: RaceMergeCoreOutcomeR2GenerationAuthority;
  count: number;
  repository: RaceMergeCoreOutcomeR2GenerationRepository;
}): Promise<readonly RaceMergeCoreOutcomeR2Manifest[]> {
  const output: RaceMergeCoreOutcomeR2Manifest[] = [];
  while (output.length < input.count) {
    const page = await input.repository.listManifests(input.ownerId, {
      generationId: input.authority.generationId,
      cohortOrdinal: input.authority.cohortOrdinal,
      afterSourceCoreId: output.at(-1)?.sourceCoreId ?? 0,
      limit: MANIFEST_PAGE_LIMIT,
    });
    if (
      page.length < 1 ||
      page.length > MANIFEST_PAGE_LIMIT ||
      output.length + page.length > input.count
    ) {
      fail("manifest pagination is invalid");
    }
    for (const manifest of page) {
      if (
        output.length > 0 &&
        manifest.sourceCoreId <= output.at(-1)!.sourceCoreId
      ) {
        fail("manifest sequence is invalid");
      }
      output.push(manifest);
    }
  }
  return Object.freeze(output);
}

/**
 * Commits one exact, bounded Race Merge Core-outcome cohort.
 *
 * All compact objects are prepared first so the capacity gate sees the exact
 * retained-byte projection before any R2 write. R2 is committed and reopened
 * before its compact receipt is registered. Replay verifies the existing
 * manifest prefix and resumes only its missing suffix. This boundary never
 * calls DNA or activates website publication.
 */
export async function commitRaceMergeCoreOutcomeR2Generation(input: {
  ownerId: string;
  generationId: string;
  cohortOrdinal: number;
  cores: readonly Readonly<{
    sourceCoreId: number;
    observations: readonly RaceMergeOutcomeEvidenceRow[];
  }>[];
  capacityGate: RaceMergeCoreOutcomeR2CapacityGate;
  store: RaceMergeCoreOutcomeR2GenerationStore;
  repository: RaceMergeCoreOutcomeR2GenerationRepository;
  startedAt: string;
  registeredAt: string;
}): Promise<RaceMergeCoreOutcomeR2GenerationResult> {
  const ownerId = identifier(input.ownerId, "ownerId");
  const generationId = identifier(input.generationId, "generationId");
  const cohortOrdinal = positiveInteger(input.cohortOrdinal, "cohortOrdinal");
  const startedAt = timestamp(input.startedAt, "startedAt");
  const registeredAt = timestamp(input.registeredAt, "registeredAt");
  if (registeredAt < startedAt) fail("registeredAt precedes startedAt");

  const orderedCores = [...input.cores].sort(
    (left, right) => left.sourceCoreId - right.sourceCoreId,
  );
  if (
    orderedCores.length < 1 ||
    orderedCores.length > RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_CORES
  ) {
    fail("Core count is outside its bounded cohort");
  }
  orderedCores.forEach((core, index) => {
    positiveInteger(core.sourceCoreId, "sourceCoreId");
    if (
      index > 0 &&
      core.sourceCoreId === orderedCores[index - 1]!.sourceCoreId
    ) {
      fail("source Core identities are not unique");
    }
  });
  const prepared = Object.freeze(
    orderedCores.map((core) =>
      input.store.prepare({
        generationId,
        sourceCoreId: core.sourceCoreId,
        observations: core.observations,
      }),
    ),
  );
  const receipts = Object.freeze(prepared.map((value) => value.receipt));
  const authority = authorityFor({ generationId, cohortOrdinal, receipts });

  const approval =
    await input.capacityGate.assertFreshCurrentCapacity(authority);
  const measuredAt = timestamp(approval.measuredAt, "capacity measuredAt");
  const validUntil = timestamp(approval.validUntil, "capacity validUntil");
  if (
    approval.version !== 1 ||
    approval.generationId !== generationId ||
    approval.cohortOrdinal !== cohortOrdinal ||
    approval.receiptSetSha256 !== authority.receiptSetSha256 ||
    approval.retainedR2Bytes !== authority.retainedR2Bytes ||
    approval.capacityAllowed !== true ||
    approval.projectedPaidCostAud !== 0 ||
    measuredAt > registeredAt ||
    validUntil <= registeredAt ||
    validUntil <= measuredAt
  ) {
    fail("fresh zero-cost capacity approval disagrees with the cohort");
  }

  const storageStatuses: ("created" | "existing")[] = [];
  for (const value of prepared) {
    const write = await input.store.commit(value);
    if (!sameReceipt(write.receipt, value.receipt)) {
      fail("committed R2 receipt disagrees with the prepared object");
    }
    const reopened = await input.store.read(write.receipt);
    if (reopened.length !== write.receipt.uniqueOutcomeCount) {
      fail("reopened R2 object disagrees with its receipt");
    }
    storageStatuses.push(write.storageStatus);
  }

  const checkpointBefore = await input.repository.begin(ownerId, {
    authority,
    startedAt,
  });
  const existing = await manifests({
    ownerId,
    authority,
    count: checkpointBefore.registeredCoreCount,
    repository: input.repository,
  });
  if (
    existing.some(
      (manifest, index) =>
        receipts[index] === undefined ||
        !sameReceipt(manifest, receipts[index]!),
    )
  ) {
    fail("durable manifest prefix disagrees with R2");
  }
  validateCheckpoint({
    checkpoint: checkpointBefore,
    authority,
    expectedReceipts: receipts.slice(0, existing.length),
    expectedStatus:
      existing.length === receipts.length ? checkpointBefore.status : "writing",
  });

  let checkpointAfter = checkpointBefore;
  for (const receipt of receipts.slice(existing.length)) {
    checkpointAfter = await input.repository.registerCore(ownerId, {
      generationId,
      cohortOrdinal,
      receipt,
      registeredAt,
    });
    validateCheckpoint({
      checkpoint: checkpointAfter,
      authority,
      expectedReceipts: receipts.slice(
        0,
        receipts.findIndex(
          (candidate) => candidate.sourceCoreId === receipt.sourceCoreId,
        ) + 1,
      ),
      expectedStatus: "writing",
    });
  }
  if (checkpointAfter.status !== "complete") {
    checkpointAfter = await input.repository.finalize(ownerId, {
      generationId,
      cohortOrdinal,
      receiptSetSha256: authority.receiptSetSha256,
      completedAt: registeredAt,
    });
  }
  validateCheckpoint({
    checkpoint: checkpointAfter,
    authority,
    expectedReceipts: receipts,
    expectedStatus: "complete",
  });

  const finalManifests = await manifests({
    ownerId,
    authority,
    count: authority.coreCount,
    repository: input.repository,
  });
  if (
    finalManifests.length !== receipts.length ||
    finalManifests.some(
      (manifest, index) => !sameReceipt(manifest, receipts[index]!),
    ) ||
    receiptSetSha256(finalManifests) !== authority.receiptSetSha256
  ) {
    fail("final durable manifests disagree with R2");
  }

  return Object.freeze({
    authority,
    checkpointBefore,
    checkpointAfter,
    receipts,
    storageStatuses: Object.freeze(storageStatuses),
    resumedRegisteredCoreCount: existing.length,
    capacityMeasuredAt: measuredAt,
    dnaApiRequestPerformed: false as const,
    persistentWritePerformed: true as const,
    paidUsageAllowed: false as const,
  });
}
