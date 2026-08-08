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
import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";
import type { ManualLedgerAssetDefinition } from "@/domain/manual-ledger";

type PersistenceResult =
  | Readonly<{ status: "created"; lifecycleVersion: string }>
  | Readonly<{
      status: "already_exists";
      fingerprint: string;
      lifecycleVersion: string;
    }>
  | Readonly<{
      status: "conflict";
      fingerprint: string;
      lifecycleVersion: string;
    }>
  | Readonly<{ status: "version_conflict"; lifecycleVersion: string }>;

export type LifecycleEconomicAssetRegistry =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      version: string;
      assets: readonly ManualLedgerAssetDefinition[];
    }>;

export type LifecycleAssetEvidence = Readonly<{
  code: string;
  kind: ManualLedgerAssetDefinition["kind"];
  precision: number;
  registryVersion: string;
}>;

export type ValidatedCoreSaleRecord = Readonly<{
  input: CoreSaleEvidenceInput;
  result: CoreSaleEvidenceResult;
  assets: readonly LifecycleAssetEvidence[];
}>;

export type ValidatedCoreBurnRecord = Readonly<{
  input: CoreBurnEventInput;
  result: CoreBurnEventResult;
}>;

export type ValidatedBurnCreditRecord = Readonly<{
  credit: BurnCreditEvidence;
  reconciliation: BurnCreditReconciliationResult;
  asset: LifecycleAssetEvidence;
}>;

export type StoredBurnEvidence = Readonly<{
  record: ValidatedCoreBurnRecord;
  fingerprint: string;
}>;

export type StoredBurnCreditEvidence = Readonly<{
  record: ValidatedBurnCreditRecord;
  fingerprint: string;
  recordFingerprint: string;
  lifecycleVersion: string;
}>;

export type LifecycleEconomicWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      saveSaleByOwner: (
        ownerId: string,
        record: ValidatedCoreSaleRecord,
        fingerprint: string,
        expectedLifecycleVersion: string,
      ) => Promise<PersistenceResult>;
      saveBurnByOwner: (
        ownerId: string,
        record: ValidatedCoreBurnRecord,
        fingerprint: string,
        expectedLifecycleVersion: string,
      ) => Promise<PersistenceResult>;
      loadBurnByOwner: (
        ownerId: string,
        burnId: string,
      ) => Promise<StoredBurnEvidence | null>;
      loadBurnCreditByOwner: (
        ownerId: string,
        creditId: string,
      ) => Promise<StoredBurnCreditEvidence | null>;
      loadBurnCreditsByOwner: (
        ownerId: string,
        burnId: string,
      ) => Promise<readonly BurnCreditEvidence[]>;
      saveBurnCreditByOwner: (
        ownerId: string,
        record: ValidatedBurnCreditRecord,
        fingerprint: string,
        expectedLifecycleVersion: string,
      ) => Promise<PersistenceResult>;
    }>;

export const unavailableLifecycleEconomicWriteRepository: LifecycleEconomicWriteRepository =
  Object.freeze({ status: "not_configured" });
export const unavailableLifecycleEconomicAssetRegistry: LifecycleEconomicAssetRegistry =
  Object.freeze({ status: "not_configured" });

type BaseResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "asset_registry_not_configured" }>;

export type SaleWriteResult =
  | BaseResult
  | Readonly<{
      status: "recorded" | "replayed";
      saleId: string;
      fingerprint: string;
      lifecycleVersion: string;
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
      lifecycleVersion: string;
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
      lifecycleVersion: string;
      reconciliationStatus: BurnCreditReconciliationResult["status"];
      ledgerPostingProposed: boolean;
      ledgerMutationAllowed: false;
      creditPredicted: false;
    }>;

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(label + " is required.");
  return normalized;
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
): Readonly<{
  status: "recorded" | "replayed";
  lifecycleVersion: string;
}> {
  if (result.status === "created") {
    return {
      status: "recorded",
      lifecycleVersion: required(result.lifecycleVersion, "Lifecycle version"),
    };
  }
  if (
    result.status === "already_exists" &&
    result.fingerprint === expectedFingerprint
  ) {
    return {
      status: "replayed",
      lifecycleVersion: required(result.lifecycleVersion, "Lifecycle version"),
    };
  }
  if (result.status === "version_conflict") {
    throw new Error("Lifecycle evidence changed; refresh before recording.");
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

function serverTime(value: string): string {
  return normalizedTimestamp(value, "Server time");
}

function assertNotFuture(value: string, now: string, label: string): void {
  if (Date.parse(value) > Date.parse(now)) {
    throw new Error(label + " cannot be in the future.");
  }
}

function readyAssetRegistry(input: {
  registry: LifecycleEconomicAssetRegistry;
  expectedVersion: string;
}): Extract<LifecycleEconomicAssetRegistry, { status: "ready" }> | null {
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
      "Lifecycle economic asset registry changed; review is required.",
    );
  }
  return input.registry;
}

function assetEvidence(
  registry: Extract<LifecycleEconomicAssetRegistry, { status: "ready" }>,
  suppliedCode: string,
): LifecycleAssetEvidence {
  const code = required(suppliedCode, "Asset").toUpperCase();
  const matches = registry.assets.filter(
    (candidate) => candidate.code.trim().toUpperCase() === code,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Lifecycle economic asset is not in the authoritative registry."
        : "Authoritative lifecycle economic asset registry is ambiguous.",
    );
  }
  const asset = matches[0]!;
  if (
    !/^[A-Z][A-Z0-9_]{1,15}$/.test(code) ||
    asset.code.trim().toUpperCase() !== code ||
    !["crypto", "fiat", "game_credit"].includes(asset.kind) ||
    !Number.isInteger(asset.precision) ||
    asset.precision < 0 ||
    asset.precision > 100
  ) {
    throw new Error("Authoritative lifecycle asset definition is invalid.");
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
  evidence: LifecycleAssetEvidence,
  label: string,
): string {
  let normalized: string;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    throw new Error(label + " must be a plain base-10 decimal.");
  }
  if (isNegativeExactDecimal(normalized) || isZeroExactDecimal(normalized)) {
    throw new Error(label + " must be greater than zero.");
  }
  const fractionLength = normalized.split(".")[1]?.length ?? 0;
  if (fractionLength > evidence.precision) {
    throw new Error(label + " exceeds the authoritative asset precision.");
  }
  return normalized;
}

function normalizedCredit(
  input: BurnCreditEvidence,
  evidence: LifecycleAssetEvidence,
  now: string,
): BurnCreditEvidence {
  const occurredAt = normalizedTimestamp(input.occurredAt, "Credit time");
  assertNotFuture(occurredAt, now, "Credit time");
  return {
    creditId: required(input.creditId, "Credit ID"),
    coreId: required(input.coreId, "Credit core ID"),
    burnId: input.burnId?.trim() || null,
    occurredAt,
    asset: evidence.code,
    amount: positiveAmount(input.amount, evidence, "BGC amount"),
    evidenceSource: input.evidenceSource,
    evidenceStatus: input.evidenceStatus,
    externalReference: input.externalReference?.trim() || null,
  };
}

function normalizedSale(
  input: CoreSaleEvidenceInput,
  registry: Extract<LifecycleEconomicAssetRegistry, { status: "ready" }>,
  now: string,
): Readonly<{
  input: CoreSaleEvidenceInput;
  assets: readonly LifecycleAssetEvidence[];
}> {
  const occurredAt = normalizedTimestamp(input.occurredAt, "Sale time");
  const recordedAt = normalizedTimestamp(input.recordedAt, "Recorded time");
  assertNotFuture(occurredAt, now, "Sale time");
  assertNotFuture(recordedAt, now, "Recorded time");
  const byCode = new Map<string, LifecycleAssetEvidence>();
  const normalize = (
    value: { asset: string; amount: string },
    label: string,
  ) => {
    const evidence = assetEvidence(registry, value.asset);
    byCode.set(evidence.code, evidence);
    return {
      asset: evidence.code,
      amount: positiveAmount(value.amount, evidence, label),
    };
  };
  return {
    input: {
      saleId: required(input.saleId, "Sale ID"),
      coreId: required(input.coreId, "Core ID"),
      occurredAt,
      recordedAt,
      evidenceSource: input.evidenceSource,
      evidenceStatus: input.evidenceStatus,
      ownershipAtSale: input.ownershipAtSale,
      proceeds: normalize(input.proceeds, "Sale proceeds"),
      sellingFees: input.sellingFees.map((fee, index) =>
        normalize(fee, "Selling fee " + (index + 1)),
      ),
      acquisitionCost:
        input.acquisitionCost === null
          ? null
          : normalize(input.acquisitionCost, "Acquisition cost"),
      externalReference: input.externalReference?.trim() || null,
      recommendationReferenceId:
        input.recommendationReferenceId?.trim() || null,
    },
    assets: [...byCode.values()].sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
  };
}

function normalizedBurn(
  input: CoreBurnEventInput,
  now: string,
): CoreBurnEventInput {
  const occurredAt = normalizedTimestamp(input.occurredAt, "Burn time");
  const recordedAt = normalizedTimestamp(input.recordedAt, "Recorded time");
  assertNotFuture(occurredAt, now, "Burn time");
  assertNotFuture(recordedAt, now, "Recorded time");
  return {
    burnId: required(input.burnId, "Burn ID"),
    coreId: required(input.coreId, "Core ID"),
    coreClass: input.coreClass,
    occurredAt,
    recordedAt,
    evidenceSource: input.evidenceSource,
    evidenceStatus: input.evidenceStatus,
    ownershipAtBurn: input.ownershipAtBurn,
    reason: required(input.reason, "Burn evidence reason"),
    recommendationReferenceId: input.recommendationReferenceId?.trim() || null,
  };
}

export async function recordCoreSaleEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  assetRegistry: LifecycleEconomicAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedLifecycleVersion: string;
  serverNow: string;
  sale: CoreSaleEvidenceInput;
}): Promise<SaleWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured")
    return { status: "persistence_not_configured" };
  const registry = readyAssetRegistry({
    registry: input.assetRegistry,
    expectedVersion: input.expectedAssetRegistryVersion,
  });
  if (registry === null) return { status: "asset_registry_not_configured" };
  const now = serverTime(input.serverNow);
  const sale = normalizedSale(input.sale, registry, now);
  const record: ValidatedCoreSaleRecord = {
    input: sale.input,
    result: assessCoreSaleEvidence(sale.input),
    assets: sale.assets,
  };
  const evidenceFingerprint = fingerprint(record);
  const persisted = await input.repository.saveSaleByOwner(
    ownerId,
    record,
    evidenceFingerprint,
    required(input.expectedLifecycleVersion, "Expected lifecycle version"),
  );
  const resolved = resolvedStatus(persisted, evidenceFingerprint);
  return {
    ...resolved,
    saleId: record.result.saleId,
    fingerprint: evidenceFingerprint,
    evidenceStatus: record.result.status,
    realisedResult: record.result.realisedResult.status,
    ownershipMutationAllowed: false,
  };
}

export async function recordCoreBurnEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  expectedLifecycleVersion: string;
  serverNow: string;
  burn: CoreBurnEventInput;
}): Promise<BurnWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured")
    return { status: "persistence_not_configured" };
  const burn = normalizedBurn(input.burn, serverTime(input.serverNow));
  const record: ValidatedCoreBurnRecord = {
    input: burn,
    result: assessCoreBurnEvent(burn),
  };
  const evidenceFingerprint = fingerprint(record);
  const persisted = await input.repository.saveBurnByOwner(
    ownerId,
    record,
    evidenceFingerprint,
    required(input.expectedLifecycleVersion, "Expected lifecycle version"),
  );
  const resolved = resolvedStatus(persisted, evidenceFingerprint);
  return {
    ...resolved,
    burnId: record.result.burnId,
    fingerprint: evidenceFingerprint,
    evidenceStatus: record.result.status,
    activeVaultProjection: record.result.activeVaultProjection,
    ownershipMutationAllowed: false,
    burnCreditPredicted: false,
  };
}

export async function recordBurnCreditEvidence(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: LifecycleEconomicWriteRepository;
  assetRegistry: LifecycleEconomicAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedLifecycleVersion: string;
  serverNow: string;
  credit: BurnCreditEvidence;
}): Promise<BurnCreditWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured")
    return { status: "persistence_not_configured" };
  const registry = readyAssetRegistry({
    registry: input.assetRegistry,
    expectedVersion: input.expectedAssetRegistryVersion,
  });
  if (registry === null) return { status: "asset_registry_not_configured" };
  const evidence = assetEvidence(registry, input.credit.asset);
  if (evidence.code !== "BGC" || evidence.kind !== "game_credit") {
    throw new Error("Burn credit requires the BGC game-credit asset.");
  }
  const credit = normalizedCredit(
    input.credit,
    evidence,
    serverTime(input.serverNow),
  );
  if (credit.burnId === null) {
    throw new Error("Burn credit must reference one durable burn ID.");
  }
  const evidenceFingerprint = fingerprint({ credit, asset: evidence });
  const storedCredit = await input.repository.loadBurnCreditByOwner(
    ownerId,
    credit.creditId,
  );
  if (storedCredit !== null) {
    if (
      fingerprint({
        credit: storedCredit.record.credit,
        asset: storedCredit.record.asset,
      }) !== storedCredit.fingerprint ||
      fingerprint(storedCredit.record) !== storedCredit.recordFingerprint
    ) {
      throw new Error("Stored burn credit evidence fingerprint is invalid.");
    }
    if (storedCredit.fingerprint !== evidenceFingerprint) {
      throw new Error(
        "Lifecycle economic durable identity conflicts with prior evidence.",
      );
    }
    return {
      status: "replayed",
      creditId: credit.creditId,
      burnId: credit.burnId,
      fingerprint: evidenceFingerprint,
      lifecycleVersion: required(
        storedCredit.lifecycleVersion,
        "Lifecycle version",
      ),
      reconciliationStatus: storedCredit.record.reconciliation.status,
      ledgerPostingProposed:
        storedCredit.record.reconciliation.ledgerPostingProposed,
      ledgerMutationAllowed: false,
      creditPredicted: false,
    };
  }
  const storedBurn = await input.repository.loadBurnByOwner(
    ownerId,
    credit.burnId,
  );
  if (storedBurn === null) throw new Error("Referenced burn was not found.");
  if (fingerprint(storedBurn.record) !== storedBurn.fingerprint) {
    throw new Error("Stored burn evidence fingerprint is invalid.");
  }
  if (storedBurn.record.result.coreId !== credit.coreId) {
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
      burnId: storedBurn.record.result.burnId,
      coreId: storedBurn.record.result.coreId,
      occurredAt: storedBurn.record.input.occurredAt,
      status: storedBurn.record.result.status,
    },
    credits: [...existingCredits, credit],
  });
  const record: ValidatedBurnCreditRecord = {
    credit,
    reconciliation,
    asset: evidence,
  };
  const persisted = await input.repository.saveBurnCreditByOwner(
    ownerId,
    record,
    evidenceFingerprint,
    required(input.expectedLifecycleVersion, "Expected lifecycle version"),
  );
  const resolved = resolvedStatus(persisted, evidenceFingerprint);
  return {
    ...resolved,
    creditId: credit.creditId,
    burnId: credit.burnId,
    fingerprint: evidenceFingerprint,
    reconciliationStatus: reconciliation.status,
    ledgerPostingProposed: reconciliation.ledgerPostingProposed,
    ledgerMutationAllowed: false,
    creditPredicted: false,
  };
}
