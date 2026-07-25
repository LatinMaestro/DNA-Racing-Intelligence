import { createHash } from "node:crypto";
import {
  reconcileBurnCredit,
  type BurnCreditEvidence,
  type BurnCreditReconciliationResult,
} from "@/domain/burn-credit-reconciliation";
import {
  assessCoreBurnEvent,
  type CoreBurnEventInput,
  type CoreBurnEventResult,
} from "@/domain/core-burn-event";
import {
  assessCoreSaleEvidence,
  type CoreSaleEvidenceInput,
  type CoreSaleEvidenceResult,
} from "@/domain/core-sale-evidence";
import { normalizeExactDecimal } from "@/domain/exact-decimal";

export type LifecycleEconomicPersistenceResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "already_exists"; fingerprint: string }>
  | Readonly<{ status: "conflict"; fingerprint: string }>;

export type ValidatedCoreSaleRecord = Readonly<{
  input: CoreSaleEvidenceInput;
  assessment: CoreSaleEvidenceResult;
}>;

export type ValidatedCoreBurnRecord = Readonly<{
  input: CoreBurnEventInput;
  assessment: CoreBurnEventResult;
}>;

export type ValidatedBurnCreditRecord = Readonly<{
  credit: BurnCreditEvidence;
  reconciliation: BurnCreditReconciliationResult;
}>;

export type StoredLifecycleEconomicRecord<T> = Readonly<{
  record: T;
  fingerprint: string;
}>;

export type LifecycleEconomicWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      saveSaleByOwner: (
        ownerId: string,
        record: ValidatedCoreSaleRecord,
        fingerprint: string,
      ) => Promise<LifecycleEconomicPersistenceResult>;
      saveBurnByOwner: (
        ownerId: string,
        record: ValidatedCoreBurnRecord,
        fingerprint: string,
      ) => Promise<LifecycleEconomicPersistenceResult>;
      loadBurnByOwner: (
        ownerId: string,
        burnId: string,
      ) => Promise<StoredLifecycleEconomicRecord<ValidatedCoreBurnRecord> | null>;
      loadBurnCreditByOwner: (
        ownerId: string,
        creditId: string,
      ) => Promise<StoredLifecycleEconomicRecord<ValidatedBurnCreditRecord> | null>;
      loadBurnCreditsForBurnByOwner: (
        ownerId: string,
        burnId: string,
      ) => Promise<readonly BurnCreditEvidence[]>;
      saveBurnCreditByOwner: (
        ownerId: string,
        record: ValidatedBurnCreditRecord,
        fingerprint: string,
      ) => Promise<LifecycleEconomicPersistenceResult>;
    }>;

type WriteStatus = "recorded" | "replayed";

export type CoreSaleWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: WriteStatus;
      saleId: string;
      fingerprint: string;
      evidenceStatus: CoreSaleEvidenceResult["status"];
      realisedResultStatus: CoreSaleEvidenceResult["realisedResult"]["status"];
    }>;

export type CoreBurnWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: WriteStatus;
      burnId: string;
      fingerprint: string;
      evidenceStatus: CoreBurnEventResult["status"];
      activeVaultProjection: CoreBurnEventResult["activeVaultProjection"];
    }>;

export type BurnCreditWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: WriteStatus;
      creditId: string;
      fingerprint: string;
      reconciliationStatus: BurnCreditReconciliationResult["status"];
      ledgerPostingProposed: boolean;
    }>;

export const unavailableLifecycleEconomicWriteRepository: LifecycleEconomicWriteRepository =
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

function authorizedOwner(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
}): string | null {
  const authenticatedOwnerId = optional(input.authenticatedOwnerId);
  const configuredOwnerId = optional(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) return null;
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Lifecycle economic write access denied.");
  }
  return authenticatedOwnerId;
}

function fingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resolvedStatus(
  result: LifecycleEconomicPersistenceResult,
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
    "Lifecycle economic durable identity conflicts with prior evidence.",
  );
}

function canonicalAmount(input: { asset: string; amount: string }) {
  return {
    asset: required(input.asset, "Asset").toUpperCase(),
    amount: normalizeExactDecimal(input.amount),
  };
}

function canonicalSaleInput(
  input: CoreSaleEvidenceInput,
): CoreSaleEvidenceInput {
  return {
    saleId: required(input.saleId, "Sale ID"),
    coreId: required(input.coreId, "Core ID"),
    occurredAt: timestamp(input.occurredAt, "Sale time"),
    recordedAt: timestamp(input.recordedAt, "Recorded time"),
    evidenceSource: input.evidenceSource,
    evidenceStatus: input.evidenceStatus,
    ownershipAtSale: input.ownershipAtSale,
    proceeds: canonicalAmount(input.proceeds),
    sellingFees: input.sellingFees.map(canonicalAmount),
    acquisitionCost:
      input.acquisitionCost === null
        ? null
        : canonicalAmount(input.acquisitionCost),
    externalReference: optional(input.externalReference),
    recommendationReferenceId: optional(input.recommendationReferenceId),
  };
}

function canonicalBurnInput(input: CoreBurnEventInput): CoreBurnEventInput {
  return {
    burnId: required(input.burnId, "Burn ID"),
    coreId: required(input.coreId, "Core ID"),
    coreClass: input.coreClass,
    occurredAt: timestamp(input.occurredAt, "Burn time"),
    recordedAt: timestamp(input.recordedAt, "Recorded time"),
    evidenceSource: input.evidenceSource,
    evidenceStatus: input.evidenceStatus,
    ownershipAtBurn: input.ownershipAtBurn,
    reason: required(input.reason, "Burn evidence reason"),
    recommendationReferenceId: optional(input.recommendationReferenceId),
  };
}

function canonicalCredit(input: BurnCreditEvidence): BurnCreditEvidence {
  return {
    creditId: required(input.creditId, "Credit ID"),
    coreId: required(input.coreId, "Credit core ID"),
    burnId: optional(input.burnId),
    occurredAt: timestamp(input.occurredAt, "Credit time"),
    asset: required(input.asset, "Credit asset").toUpperCase(),
    amount: normalizeExactDecimal(input.amount),
    evidenceSource: input.evidenceSource,
    evidenceStatus: input.evidenceStatus,
    externalReference: optional(input.externalReference),
  };
}

export async function recordCoreSaleEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  sale: CoreSaleEvidenceInput;
}): Promise<CoreSaleWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const canonicalInput = canonicalSaleInput(input.sale);
  const record = {
    input: canonicalInput,
    assessment: assessCoreSaleEvidence(canonicalInput),
  } as const;
  const recordFingerprint = fingerprint(record);
  const result = await input.repository.saveSaleByOwner(
    ownerId,
    record,
    recordFingerprint,
  );
  return {
    status: resolvedStatus(result, recordFingerprint),
    saleId: record.assessment.saleId,
    fingerprint: recordFingerprint,
    evidenceStatus: record.assessment.status,
    realisedResultStatus: record.assessment.realisedResult.status,
  };
}

export async function recordCoreBurnEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  burn: CoreBurnEventInput;
}): Promise<CoreBurnWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const canonicalInput = canonicalBurnInput(input.burn);
  const record = {
    input: canonicalInput,
    assessment: assessCoreBurnEvent(canonicalInput),
  } as const;
  const recordFingerprint = fingerprint(record);
  const result = await input.repository.saveBurnByOwner(
    ownerId,
    record,
    recordFingerprint,
  );
  return {
    status: resolvedStatus(result, recordFingerprint),
    burnId: record.assessment.burnId,
    fingerprint: recordFingerprint,
    evidenceStatus: record.assessment.status,
    activeVaultProjection: record.assessment.activeVaultProjection,
  };
}

export async function recordActualBurnCredit(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  credit: BurnCreditEvidence;
}): Promise<BurnCreditWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const credit = canonicalCredit(input.credit);
  if (credit.burnId === null) {
    throw new Error("A recorded burn credit requires a durable burn ID.");
  }
  const creditFingerprint = fingerprint(credit);
  const existing = await input.repository.loadBurnCreditByOwner(
    ownerId,
    credit.creditId,
  );
  if (existing !== null) {
    if (existing.fingerprint !== creditFingerprint) {
      throw new Error(
        "Lifecycle economic durable identity conflicts with prior evidence.",
      );
    }
    return {
      status: "replayed",
      creditId: credit.creditId,
      fingerprint: creditFingerprint,
      reconciliationStatus: existing.record.reconciliation.status,
      ledgerPostingProposed:
        existing.record.reconciliation.ledgerPostingProposed,
    };
  }

  const burn = await input.repository.loadBurnByOwner(ownerId, credit.burnId);
  if (burn === null) throw new Error("Confirmed burn evidence was not found.");
  if (
    burn.record.assessment.burnId !== credit.burnId ||
    burn.record.assessment.coreId !== credit.coreId
  ) {
    throw new Error(
      "Burn credit identity does not match stored burn evidence.",
    );
  }
  const priorCredits = await input.repository.loadBurnCreditsForBurnByOwner(
    ownerId,
    credit.burnId,
  );
  const reconciliation = reconcileBurnCredit({
    burn: {
      burnId: burn.record.assessment.burnId,
      coreId: burn.record.assessment.coreId,
      occurredAt: burn.record.input.occurredAt,
      status: burn.record.assessment.status,
    },
    credits: [...priorCredits, credit],
  });
  const record = { credit, reconciliation } as const;
  const result = await input.repository.saveBurnCreditByOwner(
    ownerId,
    record,
    creditFingerprint,
  );
  return {
    status: resolvedStatus(result, creditFingerprint),
    creditId: credit.creditId,
    fingerprint: creditFingerprint,
    reconciliationStatus: reconciliation.status,
    ledgerPostingProposed: reconciliation.ledgerPostingProposed,
  };
}
