import { createHash } from "node:crypto";
import { negateExactDecimal } from "@/domain/exact-decimal";
import {
  validateManualLedgerEntry,
  type ManualLedgerEntryInput,
  type ValidatedManualLedgerEntry,
} from "@/domain/manual-ledger";

export type ManualLedgerPersistenceResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "already_exists"; fingerprint: string }>
  | Readonly<{ status: "conflict"; fingerprint: string }>;

export type ValidatedManualLedgerReversal = Readonly<{
  reversalId: string;
  originalEntryId: string;
  reversedAt: string;
  reason: string;
  assetCode: string;
  assetKind: ValidatedManualLedgerEntry["assetKind"];
  postings: readonly Readonly<{
    postingId: string;
    originalPostingId: string;
    accountLabel: string;
    assetCode: string;
    assetKind: ValidatedManualLedgerEntry["assetKind"];
    signedAmount: string;
    operating: boolean;
  }>[];
  sourceFactsMutated: false;
}>;

export type ManualLedgerWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      saveEntryByOwner: (
        ownerId: string,
        entry: ValidatedManualLedgerEntry,
        fingerprint: string,
      ) => Promise<ManualLedgerPersistenceResult>;
      loadEntryByOwner: (
        ownerId: string,
        entryId: string,
      ) => Promise<ValidatedManualLedgerEntry | null>;
      saveReversalByOwner: (
        ownerId: string,
        reversal: ValidatedManualLedgerReversal,
        fingerprint: string,
      ) => Promise<ManualLedgerPersistenceResult>;
    }>;

export type ManualLedgerWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: "recorded" | "replayed";
      entryId: string;
      fingerprint: string;
      completeness: ValidatedManualLedgerEntry["completeness"];
      warnings: ValidatedManualLedgerEntry["warnings"];
    }>;

export type ManualLedgerReversalResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: "recorded" | "replayed";
      reversalId: string;
      originalEntryId: string;
      fingerprint: string;
    }>;

export const unavailableManualLedgerWriteRepository: ManualLedgerWriteRepository =
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

function resolvedStatus(
  result: ManualLedgerPersistenceResult,
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
    "Manual ledger durable identity conflicts with prior evidence.",
  );
}

export async function recordManualLedgerEntry(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualLedgerWriteRepository;
  entry: ManualLedgerEntryInput;
}): Promise<ManualLedgerWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }

  const entry = validateManualLedgerEntry(input.entry);
  const entryFingerprint = fingerprint(entry);
  const result = await input.repository.saveEntryByOwner(
    ownerId,
    entry,
    entryFingerprint,
  );
  return {
    status: resolvedStatus(result, entryFingerprint),
    entryId: entry.entryId,
    fingerprint: entryFingerprint,
    completeness: entry.completeness,
    warnings: entry.warnings,
  };
}

export async function reverseManualLedgerEntry(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualLedgerWriteRepository;
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

  const reversalId = required(input.reversalId, "Reversal ID");
  const originalEntryId = required(input.originalEntryId, "Original entry ID");
  const reason = required(input.reason, "Reversal reason");
  const reversedAt = new Date(required(input.reversedAt, "Reversed at"));
  if (Number.isNaN(reversedAt.getTime())) {
    throw new Error("Reversed at must be a valid timestamp.");
  }
  const original = await input.repository.loadEntryByOwner(
    ownerId,
    originalEntryId,
  );
  if (original === null) {
    throw new Error("Original manual ledger entry was not found.");
  }
  if (reversedAt.getTime() < Date.parse(original.occurredAt)) {
    throw new Error("Reversal cannot predate the original entry.");
  }

  const reversal: ValidatedManualLedgerReversal = {
    reversalId,
    originalEntryId,
    reversedAt: reversedAt.toISOString(),
    reason,
    assetCode: original.assetCode,
    assetKind: original.assetKind,
    postings: original.postings.map((posting) => ({
      postingId: `${reversalId}:${posting.postingId}`,
      originalPostingId: posting.postingId,
      accountLabel: posting.accountLabel,
      assetCode: posting.assetCode,
      assetKind: posting.assetKind,
      signedAmount: negateExactDecimal(posting.signedAmount),
      operating: posting.operating,
    })),
    sourceFactsMutated: false,
  };
  const reversalFingerprint = fingerprint(reversal);
  const result = await input.repository.saveReversalByOwner(
    ownerId,
    reversal,
    reversalFingerprint,
  );
  return {
    status: resolvedStatus(result, reversalFingerprint),
    reversalId,
    originalEntryId,
    fingerprint: reversalFingerprint,
  };
}
