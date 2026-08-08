import { createHash } from "node:crypto";
import {
  classifyBreedingEconomicEvidence,
  type BreedingEconomicEvidenceInput,
  type BreedingEconomicEvidenceResult,
} from "@/domain/breeding-economic-evidence";
import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";
import type { ManualLedgerAssetDefinition } from "@/domain/manual-ledger";
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
  | Readonly<{ status: "created"; economicVersion: string }>
  | Readonly<{
      status: "already_exists";
      fingerprint: string;
      economicVersion: string;
    }>
  | Readonly<{
      status: "conflict";
      fingerprint: string;
      economicVersion: string;
    }>
  | Readonly<{ status: "version_conflict"; economicVersion: string }>;

export type BreedingEconomicAssetRegistry =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      version: string;
      assets: readonly ManualLedgerAssetDefinition[];
    }>;

export type BreedingEconomicAssetEvidence = Readonly<{
  code: string;
  kind: ManualLedgerAssetDefinition["kind"];
  precision: number;
  registryVersion: string;
}>;

export type ValidatedBreedingEconomicRecord = Readonly<{
  input: BreedingEconomicEvidenceInput;
  assessment: BreedingEconomicEvidenceResult;
  assets: readonly BreedingEconomicAssetEvidence[];
}>;

export type ValidatedOffspringCostBasisRecord = Readonly<{
  request: CostBasisRequest;
  assessment: OffspringCostBasisResult;
  assets: readonly BreedingEconomicAssetEvidence[];
}>;

export type StoredBreedingEconomicRecord<T> = Readonly<{
  record: T;
  fingerprint: string;
  economicVersion: string;
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
        expectedEconomicVersion: string,
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
        expectedEconomicVersion: string,
      ) => Promise<BreedingEconomicPersistenceResult>;
    }>;

type WriteStatus = "recorded" | "replayed";

export type BreedingEconomicWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "asset_registry_not_configured" }>
  | Readonly<{
      status: WriteStatus | "held";
      evidenceId: string;
      fingerprint: string;
      evidenceStatus: BreedingEconomicEvidenceResult["status"];
      postingCount: number;
      economicVersion: string | null;
      assetRegistryVersion: string;
      ledgerMutationAllowed: false;
    }>;

export type OffspringCostBasisWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "asset_registry_not_configured" }>
  | Readonly<{
      status: WriteStatus | "held";
      assignmentId: string;
      fingerprint: string;
      assignmentStatus: OffspringCostBasisResult["status"];
      economicVersion: string | null;
      assetRegistryVersion: string;
      originalAssetsCombined: false;
      marketValueAssigned: false;
    }>;

export const unavailableBreedingEconomicWriteRepository: BreedingEconomicWriteRepository =
  Object.freeze({ status: "not_configured" });
export const unavailableBreedingEconomicAssetRegistry: BreedingEconomicAssetRegistry =
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
): Readonly<{ status: WriteStatus; economicVersion: string }> {
  if (result.status === "created") {
    return {
      status: "recorded",
      economicVersion: required(result.economicVersion, "Economic version"),
    };
  }
  if (
    result.status === "already_exists" &&
    result.fingerprint === expectedFingerprint
  ) {
    return {
      status: "replayed",
      economicVersion: required(result.economicVersion, "Economic version"),
    };
  }
  if (result.status === "version_conflict") {
    throw new Error("Breeding economics changed; refresh before recording.");
  }
  throw new Error(
    "Breeding economic durable identity conflicts with prior evidence.",
  );
}

function readyAssetRegistry(input: {
  registry: BreedingEconomicAssetRegistry;
  expectedVersion: string;
}): Extract<BreedingEconomicAssetRegistry, { status: "ready" }> | null {
  if (input.registry.status === "not_configured") return null;
  const expectedVersion = required(
    input.expectedVersion,
    "Expected asset registry version",
  );
  const actualVersion = required(
    input.registry.version,
    "Asset registry version",
  );
  if (expectedVersion !== actualVersion) {
    throw new Error(
      "Breeding economic asset registry changed; review is required.",
    );
  }
  return input.registry;
}

function assetEvidence(
  registry: Extract<BreedingEconomicAssetRegistry, { status: "ready" }>,
  suppliedCode: string,
  suppliedKind: ManualLedgerAssetDefinition["kind"],
): BreedingEconomicAssetEvidence {
  const code = required(suppliedCode, "Asset code").toUpperCase();
  const matches = registry.assets.filter(
    (candidate) => candidate.code.trim().toUpperCase() === code,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Breeding economic asset is not in the authoritative registry."
        : "Authoritative breeding economic asset registry is ambiguous.",
    );
  }
  const asset = matches[0]!;
  if (
    !/^[A-Z][A-Z0-9_]{1,15}$/.test(code) ||
    !["crypto", "fiat", "game_credit"].includes(asset.kind) ||
    !Number.isInteger(asset.precision) ||
    asset.precision < 0 ||
    asset.precision > 100
  ) {
    throw new Error(
      "Authoritative breeding economic asset definition is invalid.",
    );
  }
  if (asset.kind !== suppliedKind) {
    throw new Error(
      "Breeding economic asset metadata does not match the registry.",
    );
  }
  return {
    code,
    kind: asset.kind,
    precision: asset.precision,
    registryVersion: required(registry.version, "Asset registry version"),
  };
}

function positiveAmount(
  value: string,
  evidence: BreedingEconomicAssetEvidence,
): string {
  let normalized: string;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    throw new Error(
      "Breeding economic amount must be a plain base-10 decimal.",
    );
  }
  if (isNegativeExactDecimal(normalized) || isZeroExactDecimal(normalized)) {
    throw new Error("Breeding economic amount must be greater than zero.");
  }
  if ((normalized.split(".")[1]?.length ?? 0) > evidence.precision) {
    throw new Error(
      "Breeding economic amount exceeds authoritative precision.",
    );
  }
  return normalized;
}

function assertNotFuture(
  value: string | null,
  now: string,
  label: string,
): void {
  if (value !== null && Date.parse(value) > Date.parse(now)) {
    throw new Error(label + " cannot be in the future.");
  }
}

function canonicalEvidence(
  input: BreedingEconomicEvidenceInput,
  registry: Extract<BreedingEconomicAssetRegistry, { status: "ready" }>,
  now: string,
): Readonly<{
  input: BreedingEconomicEvidenceInput;
  assets: readonly BreedingEconomicAssetEvidence[];
}> {
  const parentCoreIds = input.parentCoreIds
    .map((coreId) => required(coreId, "Parent core ID"))
    .sort((left, right) => left.localeCompare(right)) as [string, string];
  const assets = new Map<string, BreedingEconomicAssetEvidence>();
  const occurredAt = optionalTimestamp(input.occurredAt, "Occurrence time");
  assertNotFuture(occurredAt, now, "Occurrence time");
  const canonical = {
    evidenceId: required(input.evidenceId, "Evidence ID"),
    breedingEventId: required(input.breedingEventId, "Breeding event ID"),
    source: input.source,
    lifecycle: input.lifecycle,
    occurredAt,
    parentCoreIds,
    offspringCoreId: optional(input.offspringCoreId),
    evidenceNote: optional(input.evidenceNote),
    entries: input.entries
      .map((entry) => {
        const asset = assetEvidence(registry, entry.assetCode, entry.assetKind);
        assets.set(asset.code, asset);
        return {
          transactionId: required(entry.transactionId, "Transaction ID"),
          category: entry.category,
          direction: entry.direction,
          assetCode: asset.code,
          assetKind: asset.kind,
          amount: positiveAmount(entry.amount, asset),
          externalReference: optional(entry.externalReference),
        };
      })
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
  };
  return {
    input: canonical,
    assets: [...assets.values()].sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
  };
}

function canonicalCostBasisRequest(
  input: CostBasisRequest,
  registry: Extract<BreedingEconomicAssetRegistry, { status: "ready" }>,
  now: string,
): Readonly<{
  request: CostBasisRequest;
  assets: readonly BreedingEconomicAssetEvidence[];
}> {
  const assets = new Map<string, BreedingEconomicAssetEvidence>();
  const breedingOccurredAt = timestamp(
    input.breedingOccurredAt,
    "Breeding occurrence time",
  );
  const requestedAt = timestamp(input.requestedAt, "Assignment request time");
  assertNotFuture(breedingOccurredAt, now, "Breeding occurrence time");
  assertNotFuture(requestedAt, now, "Assignment request time");
  const request = {
    assignmentId: required(input.assignmentId, "Assignment ID"),
    offspringCoreId: required(input.offspringCoreId, "Offspring core ID"),
    breedingEventId: required(input.breedingEventId, "Breeding event ID"),
    breedingOccurredAt,
    requestedAt,
    ownershipStatus: input.ownershipStatus,
    breedingEventStatus: input.breedingEventStatus,
    costs: input.costs
      .map((cost) => {
        const asset = assetEvidence(registry, cost.assetCode, cost.assetKind);
        assets.set(asset.code, asset);
        return {
          transactionId: required(cost.transactionId, "Cost transaction ID"),
          category: cost.category,
          source: cost.source,
          evidenceStatus: cost.evidenceStatus,
          assetCode: asset.code,
          assetKind: asset.kind,
          amount: positiveAmount(cost.amount, asset),
        };
      })
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
    refunds: input.refunds
      .map((refund) => {
        const asset = assetEvidence(
          registry,
          refund.assetCode,
          refund.assetKind,
        );
        assets.set(asset.code, asset);
        return {
          transactionId: required(
            refund.transactionId,
            "Refund transaction ID",
          ),
          appliesToTransactionId: required(
            refund.appliesToTransactionId,
            "Refund cost reference",
          ),
          source: refund.source,
          evidenceStatus: refund.evidenceStatus,
          assetCode: asset.code,
          assetKind: asset.kind,
          amount: positiveAmount(refund.amount, asset),
        };
      })
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
  };
  return {
    request,
    assets: [...assets.values()].sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
  };
}

export async function recordBreedingEconomicEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: BreedingEconomicWriteRepository;
  assetRegistry: BreedingEconomicAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedEconomicVersion: string;
  serverNow: string;
  evidence: BreedingEconomicEvidenceInput;
}): Promise<BreedingEconomicWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const registry = readyAssetRegistry({
    registry: input.assetRegistry,
    expectedVersion: input.expectedAssetRegistryVersion,
  });
  if (registry === null) return { status: "asset_registry_not_configured" };
  const now = timestamp(input.serverNow, "Server time");
  const canonical = canonicalEvidence(input.evidence, registry, now);
  const evidence = canonical.input;
  const evidenceFingerprint = fingerprint(canonical);
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
      economicVersion: required(existing.economicVersion, "Economic version"),
      assetRegistryVersion: registry.version,
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
      economicVersion: null,
      assetRegistryVersion: registry.version,
      ledgerMutationAllowed: false,
    };
  }
  const record = {
    input: evidence,
    assessment,
    assets: canonical.assets,
  } as const;
  const result = await input.repository.saveEvidenceByOwner(
    ownerId,
    record,
    evidenceFingerprint,
    required(input.expectedEconomicVersion, "Expected economic version"),
  );
  const resolved = resolvedStatus(result, evidenceFingerprint);
  return {
    ...resolved,
    evidenceId: evidence.evidenceId,
    fingerprint: evidenceFingerprint,
    evidenceStatus: assessment.status,
    postingCount: assessment.postings.length,
    assetRegistryVersion: registry.version,
    ledgerMutationAllowed: false,
  };
}

export async function assignOffspringCostBasis(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: BreedingEconomicWriteRepository;
  assetRegistry: BreedingEconomicAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedEconomicVersion: string;
  serverNow: string;
  assignment: CostBasisRequest;
}): Promise<OffspringCostBasisWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const registry = readyAssetRegistry({
    registry: input.assetRegistry,
    expectedVersion: input.expectedAssetRegistryVersion,
  });
  if (registry === null) return { status: "asset_registry_not_configured" };
  const now = timestamp(input.serverNow, "Server time");
  const canonical = canonicalCostBasisRequest(input.assignment, registry, now);
  const request = canonical.request;
  const requestFingerprint = fingerprint(canonical);
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
      economicVersion: required(existing.economicVersion, "Economic version"),
      assetRegistryVersion: registry.version,
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
      economicVersion: null,
      assetRegistryVersion: registry.version,
      originalAssetsCombined: false,
      marketValueAssigned: false,
    };
  }
  const record = { request, assessment, assets: canonical.assets } as const;
  const result = await input.repository.saveCostBasisByOwner(
    ownerId,
    record,
    requestFingerprint,
    required(input.expectedEconomicVersion, "Expected economic version"),
  );
  const resolved = resolvedStatus(result, requestFingerprint);
  return {
    ...resolved,
    assignmentId: request.assignmentId,
    fingerprint: requestFingerprint,
    assignmentStatus: assessment.status,
    assetRegistryVersion: registry.version,
    originalAssetsCombined: false,
    marketValueAssigned: false,
  };
}
