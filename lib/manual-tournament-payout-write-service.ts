import { createHash } from "node:crypto";
import {
  createManualTournamentPayout,
  type ManualTournamentPayout,
  type ManualTournamentPayoutInput,
} from "@/domain/manual-tournament-payout";
import {
  reconcileManualTournamentPrize,
  type ImportedTournamentPrizeInput,
  type TournamentPrizeReconciliation,
  type TournamentPrizeReconciliationDecision,
} from "@/domain/tournament-prize-reconciliation";

export type ManualTournamentPayoutPersistenceResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "already_exists"; fingerprint: string }>
  | Readonly<{ status: "conflict"; fingerprint: string }>;

export type StoredManualTournamentPayout = Readonly<{
  payout: ManualTournamentPayout;
  reconciliation: TournamentPrizeReconciliation;
  revision: number;
}>;

export type ManualTournamentPayoutWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadImportedCandidatesByOwner: (
        ownerId: string,
        query: Readonly<{
          tournamentId: string;
          occurredAt: string;
          assetCode: string;
          amount: string;
        }>,
      ) => Promise<readonly ImportedTournamentPrizeInput[]>;
      savePayoutByOwner: (
        ownerId: string,
        payout: ManualTournamentPayout,
        reconciliation: TournamentPrizeReconciliation,
        fingerprint: string,
      ) => Promise<ManualTournamentPayoutPersistenceResult>;
      loadPayoutByOwner: (
        ownerId: string,
        payoutId: string,
      ) => Promise<StoredManualTournamentPayout | null>;
      saveReconciliationDecisionByOwner: (
        ownerId: string,
        input: Readonly<{
          payoutId: string;
          expectedRevision: number;
          decision: TournamentPrizeReconciliationDecision;
          reconciliation: TournamentPrizeReconciliation;
        }>,
        fingerprint: string,
      ) => Promise<ManualTournamentPayoutPersistenceResult>;
    }>;

export type ManualTournamentPayoutWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: "recorded" | "replayed";
      payoutId: string;
      fingerprint: string;
      reconciliationStatus: TournamentPrizeReconciliation["status"];
      aggregateStatus: TournamentPrizeReconciliation["manualPayoutAggregateStatus"];
      candidateCount: number;
      allocationStatus: ManualTournamentPayout["allocationStatus"];
    }>;

export type ManualTournamentPayoutDecisionResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{
      status: "recorded" | "replayed";
      payoutId: string;
      fingerprint: string;
      reconciliationStatus: Extract<
        TournamentPrizeReconciliation["status"],
        "confirmed_duplicate" | "confirmed_separate"
      >;
      aggregateStatus: TournamentPrizeReconciliation["manualPayoutAggregateStatus"];
    }>;

export const unavailableManualTournamentPayoutWriteRepository: ManualTournamentPayoutWriteRepository =
  Object.freeze({ status: "not_configured" });

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
    throw new Error("Manual tournament payout write access denied.");
  }
  return authenticatedOwnerId;
}

function fingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resolvedStatus(
  result: ManualTournamentPayoutPersistenceResult,
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
    "Manual tournament payout durable identity conflicts with prior evidence.",
  );
}

function candidateQuery(payout: ManualTournamentPayout) {
  return {
    tournamentId: payout.tournamentId,
    occurredAt: payout.occurredAt,
    assetCode: payout.assetCode,
    amount: payout.amount,
  } as const;
}

function reconciliationInput(payout: ManualTournamentPayout) {
  return {
    payoutId: payout.payoutId,
    occurredAt: payout.occurredAt,
    tournamentId: payout.tournamentId,
    bracketId: payout.bracketId,
    stage: payout.stage,
    assetCode: payout.assetCode,
    amount: payout.amount,
    externalReference: payout.externalReference,
  } as const;
}

function normalizeDecision(
  decision: TournamentPrizeReconciliationDecision,
): TournamentPrizeReconciliationDecision {
  const decidedAt = new Date(decision.decidedAt);
  if (Number.isNaN(decidedAt.getTime())) {
    throw new Error("Reconciliation decision timestamp must be valid.");
  }
  const reason = decision.reason.trim();
  if (reason === "") {
    throw new Error("Reconciliation decision reason is required.");
  }
  return decision.kind === "confirmed_duplicate"
    ? {
        kind: "confirmed_duplicate",
        importedTransactionId: decision.importedTransactionId.trim(),
        decidedAt: decidedAt.toISOString(),
        reason,
      }
    : {
        kind: "confirmed_separate",
        decidedAt: decidedAt.toISOString(),
        reason,
      };
}

export async function recordManualTournamentPayout(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualTournamentPayoutWriteRepository;
  payout: ManualTournamentPayoutInput;
}): Promise<ManualTournamentPayoutWriteResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }

  const payout = createManualTournamentPayout(input.payout);
  const candidates = await input.repository.loadImportedCandidatesByOwner(
    ownerId,
    candidateQuery(payout),
  );
  const reconciliation = reconcileManualTournamentPrize(
    reconciliationInput(payout),
    candidates,
  );
  const payoutFingerprint = fingerprint({ payout, reconciliation });
  const result = await input.repository.savePayoutByOwner(
    ownerId,
    payout,
    reconciliation,
    payoutFingerprint,
  );

  return {
    status: resolvedStatus(result, payoutFingerprint),
    payoutId: payout.payoutId,
    fingerprint: payoutFingerprint,
    reconciliationStatus: reconciliation.status,
    aggregateStatus: reconciliation.manualPayoutAggregateStatus,
    candidateCount: reconciliation.candidates.length,
    allocationStatus: payout.allocationStatus,
  };
}

export async function decideManualTournamentPayoutReconciliation(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualTournamentPayoutWriteRepository;
  payoutId: string;
  expectedRevision: number;
  decision: TournamentPrizeReconciliationDecision;
}): Promise<ManualTournamentPayoutDecisionResult> {
  const ownerId = authorizedOwner(input);
  if (ownerId === null) return { status: "identity_not_connected" };
  if (input.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }
  const payoutId = input.payoutId.trim();
  if (payoutId === "") throw new Error("Manual payout ID is required.");
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  ) {
    throw new Error("Expected reconciliation revision is invalid.");
  }

  const stored = await input.repository.loadPayoutByOwner(ownerId, payoutId);
  if (stored === null) {
    throw new Error("Manual tournament payout was not found.");
  }
  if (stored.payout.payoutId !== payoutId) {
    throw new Error("Stored manual tournament payout identity is invalid.");
  }
  if (stored.revision !== input.expectedRevision) {
    throw new Error("Manual tournament payout revision is stale.");
  }

  const decision = normalizeDecision(input.decision);
  const candidates = await input.repository.loadImportedCandidatesByOwner(
    ownerId,
    candidateQuery(stored.payout),
  );
  const reconciliation = reconcileManualTournamentPrize(
    reconciliationInput(stored.payout),
    candidates,
    decision,
  );
  if (
    reconciliation.status !== "confirmed_duplicate" &&
    reconciliation.status !== "confirmed_separate"
  ) {
    throw new Error("Reconciliation decision did not produce a final state.");
  }

  const durableDecision = {
    payoutId,
    expectedRevision: input.expectedRevision,
    decision,
    reconciliation,
  } as const;
  const decisionFingerprint = fingerprint(durableDecision);
  const result = await input.repository.saveReconciliationDecisionByOwner(
    ownerId,
    durableDecision,
    decisionFingerprint,
  );
  return {
    status: resolvedStatus(result, decisionFingerprint),
    payoutId,
    fingerprint: decisionFingerprint,
    reconciliationStatus: reconciliation.status,
    aggregateStatus: reconciliation.manualPayoutAggregateStatus,
  };
}
