import { createHash } from "node:crypto";
import {
  classifyBreedingEconomicEvidence,
  type BreedingEconomicEvidenceInput,
  type BreedingEconomicEvidenceResult,
} from "@/domain/breeding-economic-evidence";
import { normalizeExactDecimal } from "@/domain/exact-decimal";
import {
  buildOffspringCostBasis,
  type OffspringCostBasisInput,
  type OffspringCostBasisResult,
} from "@/domain/offspring-cost-basis";

type CostBasisRequest = Omit<
  OffspringCostBasisInput,
  "previouslyAssignedTransactionIds"
>;

export type BreedingEconomicPersistenceResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "already_exists"; fingerprint: string }>
  | Readonly<{ status: "conflict"; fingerprint: string }>;

export type ValidatedBreedingEconomicRecord = Readonly<{
  input: BreedingEconomicEvidenceInput;
  assessment: BreedingEconomicEvidenceResult;
}>;

export type ValidatedOffspringCostBasisRecord = Readonly<{
  request: CostBasisRequest;
  assessment: OffspringCostBasisResult;
}>;

export type StoredBreedingEconomicRecord<T> = Readonly<{
  record: T;
  fingerprint: string;
}>;

export type BreedingEconomicWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadEvidenceByOwner: (
        ownerId: string,
        evidenceId: string,
      ) => Promise<StoredBreedingEconomicRecord<ValidatedBreedingEconomicRecord> | null>;
      saveEvidenceByOwner: (
        ownerId: string,
        record: ValidatedBreedingEconomicRecord,
        fingerprint: string,
      ) => Promise<BreedingEconomicPersistenceResult>;
      loadCostBasisByOwner: (
        ownerId: string,
        assignmentId: string,
      ) => Promise<StoredBreedingEconomicRecord<ValidatedOffspringCostBasisRecord> | null>;
      loadAssignedTransactionIdsByOwner: (
        ownerId: string,
        transactionIds: readonly string[],
      ) => Promise<readonly string[]>;
      saveCostBasisByOwner: (
        ownerId: string,
        record: ValidatedOffspringCostBasisRecord,
        fingerprint: string,
      ) => Promise<BreedingEconomicPersistenceResult>;
    }>;

type WriteStatus = "recorded" | "replayed";

export type BreedingEconomicWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: WriteStatus | "held";
      evidenceId: string;
      fingerprint: string;
      evidenceStatus: BreedingEconomicEvidenceResult["status"];
      postingCount: number;
      ledgerMutationAllowed: false;
    }>;

export type OffspringCostBasisWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: WriteStatus | "held";
      assignmentId: string;
      fingerprint: string;
      assignmentStatus: OffspringCostBasisResult["status"];
      originalAssetsCombined: false;
      marketValueAssigned: false;
    }>;

export const unavailableBreedingEconomicWriteRepository: BreedingEconomicWriteRepository =
  Object.freeze({ status: "not_configured" });

function optional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(required(value, label));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return parsed.toISOString();
}

function optionalTimestamp(value: string | null, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function authorizedOwner(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
}): string | null {
  const authenticatedOwnerId = optional(input.authenticatedOwnerId);
  const configuredOwnerId = optional(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) return null;
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Breeding economic write access denied.");
  }
  return authenticatedOwnerId;
}

function fingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resolvedStatus(
  result: BreedingEconomicPersistenceResult,
  expectedFingerprint: string,
): WriteStatus {
  if (result.status === "created") return "recorded";
  if (
    result.status === "already_exists" &&
    result.fingerprint === expectedFingerprint
  ) {
    return "replayed";
  }
  throw new Error(
    "Breeding economic durable identity conflicts with prior evidence.",
  );
}

function canonicalEvidence(
  input: BreedingEconomicEvidenceInput,
): BreedingEconomicEvidenceInput {
  const parentCoreIds = input.parentCoreIds
    .map((coreId) => required(coreId, "Parent core ID"))
    .sort((left, right) => left.localeCompare(right)) as [string, string];
  return {
    evidenceId: required(input.evidenceId, "Evidence ID"),
    breedingEventId: required(input.breedingEventId, "Breeding event ID"),
    source: input.source,
    lifecycle: input.lifecycle,
    occurredAt: optionalTimestamp(input.occurredAt, "Occurrence time"),
    parentCoreIds,
    offspringCoreId: optional(input.offspringCoreId),
    evidenceNote: optional(input.evidenceNote),
    entries: input.entries
      .map((entry) => ({
        transactionId: required(entry.transactionId, "Transaction ID"),
        category: entry.category,
        direction: entry.direction,
        assetCode: required(entry.assetCode, "Asset code").toUpperCase(),
        assetKind: entry.assetKind,
        amount: normalizeExactDecimal(entry.amount),
        externalReference: optional(entry.externalReference),
      }))
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
  };
}

function canonicalCostBasisRequest(input: CostBasisRequest): CostBasisRequest {
  return {
    assignmentId: required(input.assignmentId, "Assignment ID"),
    offspringCoreId: required(input.offspringCoreId, "Offspring core ID"),
    breedingEventId: required(input.breedingEventId, "Breeding event ID"),
    breedingOccurredAt: timestamp(
      input.breedingOccurredAt,
      "Breeding occurrence time",
    ),
    requestedAt: timestamp(input.requestedAt, "Assignment request time"),
    ownershipStatus: input.ownershipStatus,
    breedingEventStatus: input.breedingEventStatus,
    costs: input.costs
      .map((cost) => ({
        transactionId: required(cost.transactionId, "Cost transaction ID"),
        category: cost.category,
        source: cost.source,
        evidenceStatus: cost.evidenceStatus,
        assetCode: required(cost.assetCode, "Asset code").toUpperCase(),
        assetKind: cost.assetKind,
        amount: normalizeExactDecimal(cost.amount),
      }))
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
    refunds: input.refunds
      .map((refund) => ({
        transactionId: required(refund.transactionId, "Refund transaction ID"),
        appliesToTransactionId: required(
          refund.appliesToTransactionId,
          "Refund cost reference",
        ),
        source: refund.source,
        evidenceStatus: refund.evidenceStatus,
        assetCode: required(refund.assetCode, "Asset code").toUpperCase(),
        assetKind: refund.assetKind,
        amount: normalizeExactDecimal(refund.amount),
      }))
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
  };
}

export async function recordBreedingEconomicEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: BreedingEconomicWriteRepository;
  evidence: BreedingEconomicEvidenceInput;
}): Promise<BreedingEconomicWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const evidence = canonicalEvidence(input.evidence);
  const evidenceFingerprint = fingerprint(evidence);
  const existing = await input.repository.loadEvidenceByOwner(
    ownerId,
    evidence.evidenceId,
  );
  if (existing !== null) {
    if (existing.fingerprint !== evidenceFingerprint) {
      throw new Error(
        "Breeding economic durable identity conflicts with prior evidence.",
      );
    }
    return {
      status: "replayed",
      evidenceId: evidence.evidenceId,
      fingerprint: evidenceFingerprint,
      evidenceStatus: existing.record.assessment.status,
      postingCount: existing.record.assessment.postings.length,
      ledgerMutationAllowed: false,
    };
  }

  const assessment = classifyBreedingEconomicEvidence(evidence);
  if (
    assessment.status !== "postable_review" &&
    assessment.status !== "refunded_review"
  ) {
    return {
      status: "held",
      evidenceId: evidence.evidenceId,
      fingerprint: evidenceFingerprint,
      evidenceStatus: assessment.status,
      postingCount: 0,
      ledgerMutationAllowed: false,
    };
  }
  const record = { input: evidence, assessment } as const;
  const result = await input.repository.saveEvidenceByOwner(
    ownerId,
    record,
    evidenceFingerprint,
  );
  return {
    status: resolvedStatus(result, evidenceFingerprint),
    evidenceId: evidence.evidenceId,
    fingerprint: evidenceFingerprint,
    evidenceStatus: assessment.status,
    postingCount: assessment.postings.length,
    ledgerMutationAllowed: false,
  };
}

export async function assignOffspringCostBasis(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: BreedingEconomicWriteRepository;
  assignment: CostBasisRequest;
}): Promise<OffspringCostBasisWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const request = canonicalCostBasisRequest(input.assignment);
  const requestFingerprint = fingerprint(request);
  const existing = await input.repository.loadCostBasisByOwner(
    ownerId,
    request.assignmentId,
  );
  if (existing !== null) {
    if (existing.fingerprint !== requestFingerprint) {
      throw new Error(
        "Breeding economic durable identity conflicts with prior evidence.",
      );
    }
    return {
      status: "replayed",
      assignmentId: request.assignmentId,
      fingerprint: requestFingerprint,
      assignmentStatus: existing.record.assessment.status,
      originalAssetsCombined: false,
      marketValueAssigned: false,
    };
  }

  const transactionIds = [
    ...request.costs.map(({ transactionId }) => transactionId),
    ...request.refunds.map(({ transactionId }) => transactionId),
  ];
  const previouslyAssignedTransactionIds =
    await input.repository.loadAssignedTransactionIdsByOwner(
      ownerId,
      transactionIds,
    );
  const assessment = buildOffspringCostBasis({
    ...request,
    previouslyAssignedTransactionIds: [
      ...new Set(
        previouslyAssignedTransactionIds.map((transactionId) =>
          required(transactionId, "Assigned transaction ID"),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  });
  if (assessment.status !== "assignment_review") {
    return {
      status: "held",
      assignmentId: request.assignmentId,
      fingerprint: requestFingerprint,
      assignmentStatus: assessment.status,
      originalAssetsCombined: false,
      marketValueAssigned: false,
    };
  }
  const record = { request, assessment } as const;
  const result = await input.repository.saveCostBasisByOwner(
    ownerId,
    record,
    requestFingerprint,
  );
  return {
    status: resolvedStatus(result, requestFingerprint),
    assignmentId: request.assignmentId,
    fingerprint: requestFingerprint,
    assignmentStatus: assessment.status,
    originalAssetsCombined: false,
    marketValueAssigned: false,
  };
}
