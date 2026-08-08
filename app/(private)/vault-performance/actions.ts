"use server";

import type { ManualLedgerEntryInput } from "@/domain/manual-ledger";
import type { ManualTournamentPayoutInput } from "@/domain/manual-tournament-payout";
import type { TournamentPrizeReconciliationDecision } from "@/domain/tournament-prize-reconciliation";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
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
    ...input,
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
    ...input,
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
    ...input,
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
    ...input,
  });
}
