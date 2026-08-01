import { createHash } from "node:crypto";
import { negateExactDecimal } from "@/domain/exact-decimal";
import {
  validateManualLedgerEntry,
  type ManualLedgerAssetDefinition,
  type ManualLedgerEntryInput,
  type TournamentCampaignBinding,
  type ValidatedManualLedgerEntry,
} from "@/domain/manual-ledger";

export type ManualLedgerAssetRegistry =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      version: string;
      assets: readonly ManualLedgerAssetDefinition[];
    }>;

export type ManualLedgerPersistenceResult =
  | Readonly<{ status: "created"; ledgerVersion: string }>
  | Readonly<{
      status: "already_exists";
      fingerprint: string;
      ledgerVersion: string;
    }>
  | Readonly<{
      status: "conflict";
      fingerprint: string;
      ledgerVersion: string;
    }>
  | Readonly<{ status: "version_conflict"; ledgerVersion: string }>
  | Readonly<{
      status: "original_already_reversed";
      reversalId: string;
      ledgerVersion: string;
    }>
  | Readonly<{
      status: "original_changed";
      fingerprint: string;
      ledgerVersion: string;
    }>;

export type ValidatedManualLedgerReversal = Readonly<{
  reversalId: string;
  originalEntryId: string;
  originalEntryFingerprint: string;
  reversedAt: string;
  reason: string;
  assetCode: string;
  assetKind: ValidatedManualLedgerEntry["assetKind"];
  assetRegistryVersion: string;
  assetPrecision: number;
  postings: readonly Readonly<{
    postingId: string;
    originalPostingId: string;
    accountLabel: string;
    assetCode: string;
    assetKind: ValidatedManualLedgerEntry["assetKind"];
    signedAmount: string;
    operating: boolean;
    tournamentAggregationEligible: boolean;
  }>[];
  sourceFactsMutated: false;
}>;

export type ManualLedgerWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadTournamentCampaignBindingByOwner: (
        ownerId: string,
        tournamentId: string,
      ) => Promise<TournamentCampaignBinding | null>;
      saveEntryByOwner: (
        ownerId: string,
        entry: ValidatedManualLedgerEntry,
        fingerprint: string,
        expectedLedgerVersion: string,
      ) => Promise<ManualLedgerPersistenceResult>;
      loadEntryByOwner: (
        ownerId: string,
        entryId: string,
      ) => Promise<Readonly<{
        entry: ValidatedManualLedgerEntry;
        fingerprint: string;
      }> | null>;
      saveReversalByOwner: (
        ownerId: string,
        reversal: ValidatedManualLedgerReversal,
        fingerprint: string,
        expectedLedgerVersion: string,
        expectedOriginalFingerprint: string,
      ) => Promise<ManualLedgerPersistenceResult>;
    }>;

export type ManualLedgerWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "asset_registry_not_configured" }>
  | Readonly<{
      status: "recorded" | "replayed";
      entryId: string;
      fingerprint: string;
      ledgerVersion: string;
      completeness: ValidatedManualLedgerEntry["completeness"];
      warnings: ValidatedManualLedgerEntry["warnings"];
      tournamentAggregationEligible: boolean;
    }>;

export type ManualLedgerReversalResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "asset_registry_not_configured" }>
  | Readonly<{
      status: "recorded" | "replayed";
      reversalId: string;
      originalEntryId: string;
      fingerprint: string;
      ledgerVersion: string;
    }>;

export const unavailableManualLedgerWriteRepository: ManualLedgerWriteRepository =
  Object.freeze({ status: "not_configured" });
export const unavailableManualLedgerAssetRegistry: ManualLedgerAssetRegistry =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}
function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}
function canonicalTimestamp(value: string, label: string): string {
  const timestamp = new Date(required(value, label));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}
function fingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function authorizedOwner(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
}): string | null {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) return null;
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Manual ledger write access denied.");
  }
  return authenticatedOwnerId;
}
function readyAssetRegistry(input: {
  registry: ManualLedgerAssetRegistry;
  expectedVersion: string;
}): Extract<ManualLedgerAssetRegistry, { status: "ready" }> | null {
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
      "Manual ledger asset registry changed; review is required.",
    );
  }
  return input.registry;
}
function assetDefinition(
  registry: Extract<ManualLedgerAssetRegistry, { status: "ready" }>,
  suppliedCode: string,
): ManualLedgerAssetDefinition {
  const code = suppliedCode.trim().toUpperCase();
  const matches = registry.assets.filter(
    (asset) => asset.code.trim().toUpperCase() === code,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Manual ledger asset is not in the authoritative registry."
        : "Authoritative manual ledger asset registry is ambiguous.",
    );
  }
  return matches[0]!;
}
function resolvedStatus(
  result: ManualLedgerPersistenceResult,
  expectedFingerprint: string,
): Readonly<{
  status: "recorded" | "replayed";
  ledgerVersion: string;
}> {
  if (result.status === "created") {
    return {
      status: "recorded",
      ledgerVersion: required(result.ledgerVersion, "Ledger version"),
    };
  }
  if (
    result.status === "already_exists" &&
    result.fingerprint === expectedFingerprint
  ) {
    return {
      status: "replayed",
      ledgerVersion: required(result.ledgerVersion, "Ledger version"),
    };
  }
  if (result.status === "version_conflict") {
    throw new Error("Manual ledger changed; refresh before recording.");
  }
  if (result.status === "original_already_reversed") {
    throw new Error("Original manual ledger entry is already reversed.");
  }
  if (result.status === "original_changed") {
    throw new Error(
      "Original manual ledger evidence changed; review is required.",
    );
  }
  throw new Error(
    "Manual ledger durable identity conflicts with prior evidence.",
  );
}

async function campaignBinding(input: {
  repository: Extract<ManualLedgerWriteRepository, { status: "ready" }>;
  ownerId: string;
  tournamentId: string | null | undefined;
  expectedEvidenceId: string | null;
  expectedConfigurationVersion: string | null;
}): Promise<TournamentCampaignBinding | null> {
  const tournamentId = input.tournamentId?.trim() ?? "";
  const expectedEvidenceId = input.expectedEvidenceId?.trim() ?? "";
  const expectedConfigurationVersion =
    input.expectedConfigurationVersion?.trim() ?? "";
  if (tournamentId === "") {
    if (expectedEvidenceId !== "" || expectedConfigurationVersion !== "") {
      throw new Error("Tournament binding evidence requires a tournament.");
    }
    return null;
  }
  if (expectedEvidenceId === "" && expectedConfigurationVersion === "") {
    return null;
  }
  if (expectedEvidenceId === "" || expectedConfigurationVersion === "") {
    throw new Error(
      "Tournament binding evidence and configuration version are both required.",
    );
  }
  const persisted = await input.repository.loadTournamentCampaignBindingByOwner(
    input.ownerId,
    tournamentId,
  );
  if (
    persisted === null ||
    persisted.tournamentId !== tournamentId ||
    persisted.evidenceId !== expectedEvidenceId ||
    persisted.configurationVersion !== expectedConfigurationVersion
  ) {
    throw new Error("Tournament campaign binding changed; review is required.");
  }
  canonicalTimestamp(
    persisted.ownerAcknowledgedAt,
    "Tournament owner acknowledgement",
  );
  return persisted;
}

export async function recordManualLedgerEntry(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualLedgerWriteRepository;
  assetRegistry: ManualLedgerAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedLedgerVersion: string;
  serverNow: string;
  expectedTournamentEvidenceId?: string | null;
  expectedTournamentConfigurationVersion?: string | null;
  entry: ManualLedgerEntryInput;
}): Promise<ManualLedgerWriteResult> {
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
  const binding = await campaignBinding({
    repository: input.repository,
    ownerId,
    tournamentId: input.entry.tournamentId,
    expectedEvidenceId: input.expectedTournamentEvidenceId ?? null,
    expectedConfigurationVersion:
      input.expectedTournamentConfigurationVersion ?? null,
  });
  const assetRegistryVersion = required(
    registry.version,
    "Asset registry version",
  );
  const entry = validateManualLedgerEntry(input.entry, {
    assetDefinition: assetDefinition(registry, input.entry.assetCode),
    assetRegistryVersion,
    serverNow: input.serverNow,
    tournamentCampaignBinding: binding,
  });
  const entryFingerprint = fingerprint(entry);
  const resolved = resolvedStatus(
    await input.repository.saveEntryByOwner(
      ownerId,
      entry,
      entryFingerprint,
      required(input.expectedLedgerVersion, "Expected ledger version"),
    ),
    entryFingerprint,
  );
  return {
    ...resolved,
    entryId: entry.entryId,
    fingerprint: entryFingerprint,
    completeness: entry.completeness,
    warnings: entry.warnings,
    tournamentAggregationEligible: entry.tournamentAggregationEligible,
  };
}

export async function reverseManualLedgerEntry(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualLedgerWriteRepository;
  assetRegistry: ManualLedgerAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedLedgerVersion: string;
  serverNow: string;
  reversalId: string;
  originalEntryId: string;
  reversedAt: string;
  reason: string;
}): Promise<ManualLedgerReversalResult> {
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
  const reversalId = required(input.reversalId, "Reversal ID");
  const originalEntryId = required(input.originalEntryId, "Original entry ID");
  const reason = required(input.reason, "Reversal reason");
  const reversedAt = canonicalTimestamp(input.reversedAt, "Reversed at");
  const serverNow = canonicalTimestamp(input.serverNow, "Server time");
  if (Date.parse(reversedAt) > Date.parse(serverNow)) {
    throw new Error("Reversed at cannot be in the future.");
  }
  const loaded = await input.repository.loadEntryByOwner(
    ownerId,
    originalEntryId,
  );
  if (loaded === null) {
    throw new Error("Original manual ledger entry was not found.");
  }
  if (Date.parse(reversedAt) < Date.parse(loaded.entry.occurredAt)) {
    throw new Error("Reversal cannot predate the original entry.");
  }
  const definition = assetDefinition(registry, loaded.entry.assetCode);
  const assetRegistryVersion = required(
    registry.version,
    "Asset registry version",
  );
  if (
    loaded.entry.assetKind !== definition.kind ||
    loaded.entry.assetPrecision !== definition.precision ||
    loaded.entry.assetRegistryVersion !== assetRegistryVersion
  ) {
    throw new Error(
      "Original manual ledger asset registry evidence drifted; review is required.",
    );
  }
  if (fingerprint(loaded.entry) !== loaded.fingerprint) {
    throw new Error("Original manual ledger fingerprint is invalid.");
  }
  const reversal: ValidatedManualLedgerReversal = {
    reversalId,
    originalEntryId,
    originalEntryFingerprint: loaded.fingerprint,
    reversedAt,
    reason,
    assetCode: loaded.entry.assetCode,
    assetKind: loaded.entry.assetKind,
    assetRegistryVersion: loaded.entry.assetRegistryVersion,
    assetPrecision: loaded.entry.assetPrecision,
    postings: loaded.entry.postings.map((posting) => ({
      postingId: `${reversalId}:${posting.postingId}`,
      originalPostingId: posting.postingId,
      accountLabel: posting.accountLabel,
      assetCode: posting.assetCode,
      assetKind: posting.assetKind,
      signedAmount: negateExactDecimal(posting.signedAmount),
      operating: posting.operating,
      tournamentAggregationEligible: posting.tournamentAggregationEligible,
    })),
    sourceFactsMutated: false,
  };
  const reversalFingerprint = fingerprint(reversal);
  const resolved = resolvedStatus(
    await input.repository.saveReversalByOwner(
      ownerId,
      reversal,
      reversalFingerprint,
      required(input.expectedLedgerVersion, "Expected ledger version"),
      loaded.fingerprint,
    ),
    reversalFingerprint,
  );
  return {
    ...resolved,
    reversalId,
    originalEntryId,
    fingerprint: reversalFingerprint,
  };
}
