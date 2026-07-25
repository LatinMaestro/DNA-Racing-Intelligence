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

type PersistenceResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "already_exists"; fingerprint: string }>
  | Readonly<{ status: "conflict"; fingerprint: string }>;

export type StoredBurnEvidence = Readonly<{
  occurredAt: string;
  result: CoreBurnEventResult;
}>;

export type LifecycleEconomicWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      saveSaleByOwner: (
        ownerId: string,
        input: CoreSaleEvidenceInput,
        result: CoreSaleEvidenceResult,
        fingerprint: string,
      ) => Promise<PersistenceResult>;
      saveBurnByOwner: (
        ownerId: string,
        input: CoreBurnEventInput,
        result: CoreBurnEventResult,
        fingerprint: string,
      ) => Promise<PersistenceResult>;
      loadBurnByOwner: (
        ownerId: string,
        burnId: string,
      ) => Promise<StoredBurnEvidence | null>;
      loadBurnCreditsByOwner: (
        ownerId: string,
        burnId: string,
      ) => Promise<readonly BurnCreditEvidence[]>;
      saveBurnCreditByOwner: (
        ownerId: string,
        credit: BurnCreditEvidence,
        reconciliation: BurnCreditReconciliationResult,
        fingerprint: string,
      ) => Promise<PersistenceResult>;
    }>;

export const unavailableLifecycleEconomicWriteRepository: LifecycleEconomicWriteRepository =
  Object.freeze({ status: "not_configured" });

type BaseResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>;

export type SaleWriteResult =
  | BaseResult
  | Readonly<{
      status: "recorded" | "replayed";
      saleId: string;
      fingerprint: string;
      evidenceStatus: CoreSaleEvidenceResult["status"];
      realisedResult: CoreSaleEvidenceResult["realisedResult"]["status"];
      ownershipMutationAllowed: false;
    }>;

export type BurnWriteResult =
  | BaseResult
  | Readonly<{
      status: "recorded" | "replayed";
      burnId: string;
      fingerprint: string;
      evidenceStatus: CoreBurnEventResult["status"];
      activeVaultProjection: CoreBurnEventResult["activeVaultProjection"];
      ownershipMutationAllowed: false;
      burnCreditPredicted: false;
    }>;

export type BurnCreditWriteResult =
  | BaseResult
  | Readonly<{
      status: "recorded" | "replayed";
      creditId: string;
      burnId: string;
      fingerprint: string;
      reconciliationStatus: BurnCreditReconciliationResult["status"];
      ledgerPostingProposed: boolean;
      ledgerMutationAllowed: false;
      creditPredicted: false;
    }>;

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function authorizedOwner(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
}): string | null {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
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
  result: PersistenceResult,
  expectedFingerprint: string,
): "recorded" | "replayed" {
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

function normalizedTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value.trim());
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function normalizedCredit(input: BurnCreditEvidence): BurnCreditEvidence {
  return {
    creditId: input.creditId.trim(),
    coreId: input.coreId.trim(),
    burnId: input.burnId?.trim() || null,
    occurredAt: normalizedTimestamp(input.occurredAt, "Credit time"),
    asset: input.asset.trim().toUpperCase(),
    amount: input.amount.trim(),
    evidenceSource: input.evidenceSource,
    evidenceStatus: input.evidenceStatus,
    externalReference: input.externalReference?.trim() || null,
  };
}

export async function recordCoreSaleEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  sale: CoreSaleEvidenceInput;
}): Promise<SaleWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured")
    return { status: "persistence_not_configured" };
  const result = assessCoreSaleEvidence(input.sale);
  const value = { input: input.sale, result };
  const evidenceFingerprint = fingerprint(value);
  const persisted = await input.repository.saveSaleByOwner(
    ownerId,
    input.sale,
    result,
    evidenceFingerprint,
  );
  return {
    status: resolvedStatus(persisted, evidenceFingerprint),
    saleId: result.saleId,
    fingerprint: evidenceFingerprint,
    evidenceStatus: result.status,
    realisedResult: result.realisedResult.status,
    ownershipMutationAllowed: false,
  };
}

export async function recordCoreBurnEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  burn: CoreBurnEventInput;
}): Promise<BurnWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured")
    return { status: "persistence_not_configured" };
  const result = assessCoreBurnEvent(input.burn);
  const value = { input: input.burn, result };
  const evidenceFingerprint = fingerprint(value);
  const persisted = await input.repository.saveBurnByOwner(
    ownerId,
    input.burn,
    result,
    evidenceFingerprint,
  );
  return {
    status: resolvedStatus(persisted, evidenceFingerprint),
    burnId: result.burnId,
    fingerprint: evidenceFingerprint,
    evidenceStatus: result.status,
    activeVaultProjection: result.activeVaultProjection,
    ownershipMutationAllowed: false,
    burnCreditPredicted: false,
  };
}

export async function recordBurnCreditEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  credit: BurnCreditEvidence;
}): Promise<BurnCreditWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured")
    return { status: "persistence_not_configured" };
  const credit = normalizedCredit(input.credit);
  if (credit.burnId === null) {
    throw new Error("Burn credit must reference one durable burn ID.");
  }
  const storedBurn = await input.repository.loadBurnByOwner(
    ownerId,
    credit.burnId,
  );
  if (storedBurn === null) throw new Error("Referenced burn was not found.");
  if (storedBurn.result.coreId !== credit.coreId) {
    throw new Error("Burn credit core does not match the referenced burn.");
  }
  const existingCredits = await input.repository.loadBurnCreditsByOwner(
    ownerId,
    credit.burnId,
  );
  if (existingCredits.some((item) => item.creditId === credit.creditId)) {
    throw new Error("Burn credit repository returned the pending credit ID.");
  }
  const reconciliation = reconcileBurnCredit({
    burn: {
      burnId: storedBurn.result.burnId,
      coreId: storedBurn.result.coreId,
      occurredAt: storedBurn.occurredAt,
      status: storedBurn.result.status,
    },
    credits: [...existingCredits, credit],
  });
  const value = { credit, reconciliation };
  const evidenceFingerprint = fingerprint(value);
  const persisted = await input.repository.saveBurnCreditByOwner(
    ownerId,
    credit,
    reconciliation,
    evidenceFingerprint,
  );
  return {
    status: resolvedStatus(persisted, evidenceFingerprint),
    creditId: credit.creditId,
    burnId: credit.burnId,
    fingerprint: evidenceFingerprint,
    reconciliationStatus: reconciliation.status,
    ledgerPostingProposed: reconciliation.ledgerPostingProposed,
    ledgerMutationAllowed: false,
    creditPredicted: false,
  };
}
