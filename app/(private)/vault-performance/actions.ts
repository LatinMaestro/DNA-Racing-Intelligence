"use server";

import type { ManualLedgerEntryInput } from "@/domain/manual-ledger";
import type { ManualTournamentPayoutInput } from "@/domain/manual-tournament-payout";
import type { TournamentPrizeReconciliationDecision } from "@/domain/tournament-prize-reconciliation";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  recordManualLedgerEntry,
  reverseManualLedgerEntry,
  unavailableManualLedgerWriteRepository,
} from "@/lib/manual-ledger-write-service";
import {
  decideManualTournamentPayoutReconciliation,
  recordManualTournamentPayout,
  unavailableManualTournamentPayoutWriteRepository,
} from "@/lib/manual-tournament-payout-write-service";

function ownerIdentityEnvironment() {
  return {
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  };
}

async function authenticatedOwnerId(): Promise<string | null> {
  return authenticatedClerkOwnerId({
    environment: ownerIdentityEnvironment(),
  });
}

function configuredOwnerId(): string | null {
  return process.env.AUTHORIZED_CLERK_USER_ID ?? null;
}

export async function recordManualLedgerEntryAction(
  entry: ManualLedgerEntryInput,
) {
  return recordManualLedgerEntry({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualLedgerWriteRepository,
    entry,
  });
}

export async function reverseManualLedgerEntryAction(input: {
  reversalId: string;
  originalEntryId: string;
  reversedAt: string;
  reason: string;
}) {
  return reverseManualLedgerEntry({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualLedgerWriteRepository,
    ...input,
  });
}

export async function recordManualTournamentPayoutAction(
  payout: ManualTournamentPayoutInput,
) {
  return recordManualTournamentPayout({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualTournamentPayoutWriteRepository,
    payout,
  });
}

export async function decideManualTournamentPayoutReconciliationAction(input: {
  payoutId: string;
  expectedRevision: number;
  decision: TournamentPrizeReconciliationDecision;
}) {
  return decideManualTournamentPayoutReconciliation({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableManualTournamentPayoutWriteRepository,
    ...input,
  });
}
