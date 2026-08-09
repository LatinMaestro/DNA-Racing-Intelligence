"use server";

import type { ManualLedgerEntryInput } from "@/domain/manual-ledger";
import type { ManualTournamentPayoutInput } from "@/domain/manual-tournament-payout";
import type { TournamentPrizeReconciliationDecision } from "@/domain/tournament-prize-reconciliation";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  runEconomicFormAction,
  unavailableEconomicFormActionCapability,
} from "@/lib/economic-form-action-service";
import {
  recordManualLedgerEntry,
  reverseManualLedgerEntry,
  unavailableManualLedgerAssetRegistry,
  unavailableManualLedgerWriteRepository,
} from "@/lib/manual-ledger-write-service";
import {
  decideManualTournamentPayoutReconciliation,
  recordManualTournamentPayout,
  unavailableManualTournamentPayoutAssetRegistry,
  unavailableManualTournamentPayoutWriteRepository,
} from "@/lib/manual-tournament-payout-write-service";
import {
  parseManualLedgerFormData,
  parseManualTournamentPayoutFormData,
} from "@/lib/vault-performance-economic-form-data";

function authenticatedOwnerId(): Promise<string | null> {
  return authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
}

function configuredOwnerId(): string | null {
  return process.env.AUTHORIZED_CLERK_USER_ID ?? null;
}

function serverNow(): string {
  return new Date().toISOString();
}

export async function recordManualLedgerEntryAction(
  input: Readonly<{
    entry: ManualLedgerEntryInput;
    expectedAssetRegistryVersion: string;
    expectedLedgerVersion: string;
    expectedTournamentEvidenceId?: string | null;
    expectedTournamentConfigurationVersion?: string | null;
  }>,
) {
  return recordManualLedgerEntry({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualLedgerWriteRepository,
    assetRegistry: unavailableManualLedgerAssetRegistry,
    serverNow: serverNow(),
    entry: input.entry,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedLedgerVersion: input.expectedLedgerVersion,
    expectedTournamentEvidenceId: input.expectedTournamentEvidenceId ?? null,
    expectedTournamentConfigurationVersion:
      input.expectedTournamentConfigurationVersion ?? null,
  });
}

export async function recordManualLedgerFormAction(formData: FormData) {
  return runEconomicFormAction({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: unavailableEconomicFormActionCapability,
    parse: parseManualLedgerFormData,
  });
}

export async function reverseManualLedgerEntryAction(
  input: Readonly<{
    reversalId: string;
    originalEntryId: string;
    reversedAt: string;
    reason: string;
    expectedAssetRegistryVersion: string;
    expectedLedgerVersion: string;
  }>,
) {
  return reverseManualLedgerEntry({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualLedgerWriteRepository,
    assetRegistry: unavailableManualLedgerAssetRegistry,
    serverNow: serverNow(),
    reversalId: input.reversalId,
    originalEntryId: input.originalEntryId,
    reversedAt: input.reversedAt,
    reason: input.reason,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedLedgerVersion: input.expectedLedgerVersion,
  });
}

export async function recordManualTournamentPayoutAction(
  input: Readonly<{
    payout: ManualTournamentPayoutInput;
    expectedAssetRegistryVersion: string;
    expectedLedgerVersion: string;
    expectedTournamentEvidenceId: string;
    expectedTournamentConfigurationVersion: string;
    expectedActiveImportSnapshotHash: string;
    expectedCandidateSetHash: string;
    expectedCandidateTransactionIds: readonly string[];
  }>,
) {
  return recordManualTournamentPayout({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualTournamentPayoutWriteRepository,
    assetRegistry: unavailableManualTournamentPayoutAssetRegistry,
    serverNow: serverNow(),
    payout: input.payout,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedLedgerVersion: input.expectedLedgerVersion,
    expectedTournamentEvidenceId: input.expectedTournamentEvidenceId,
    expectedTournamentConfigurationVersion:
      input.expectedTournamentConfigurationVersion,
    expectedActiveImportSnapshotHash: input.expectedActiveImportSnapshotHash,
    expectedCandidateSetHash: input.expectedCandidateSetHash,
    expectedCandidateTransactionIds: input.expectedCandidateTransactionIds,
  });
}

export async function recordManualTournamentPayoutFormAction(
  formData: FormData,
) {
  return runEconomicFormAction({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: unavailableEconomicFormActionCapability,
    parse: parseManualTournamentPayoutFormData,
  });
}

export async function decideManualTournamentPayoutReconciliationAction(
  input: Readonly<{
    payoutId: string;
    expectedRevision: number;
    decision: TournamentPrizeReconciliationDecision;
    expectedAssetRegistryVersion: string;
    expectedActiveImportSnapshotHash: string;
    expectedCandidateSetHash: string;
    expectedCandidateTransactionIds: readonly string[];
  }>,
) {
  return decideManualTournamentPayoutReconciliation({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualTournamentPayoutWriteRepository,
    assetRegistry: unavailableManualTournamentPayoutAssetRegistry,
    serverNow: serverNow(),
    payoutId: input.payoutId,
    expectedRevision: input.expectedRevision,
    decision: input.decision,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedActiveImportSnapshotHash: input.expectedActiveImportSnapshotHash,
    expectedCandidateSetHash: input.expectedCandidateSetHash,
    expectedCandidateTransactionIds: input.expectedCandidateTransactionIds,
  });
}
