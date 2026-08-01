import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualTournamentPayout } from "@/domain/manual-tournament-payout";
import type {
  ImportedTournamentPrizeInput,
  TournamentPrizeReconciliation,
} from "@/domain/tournament-prize-reconciliation";
import {
  decideManualTournamentPayoutReconciliation,
  recordManualTournamentPayout,
  unavailableManualTournamentPayoutAssetRegistry,
  unavailableManualTournamentPayoutWriteRepository,
  type ManualTournamentPayoutWriteRepository,
  type StoredManualTournamentPayout,
  type TournamentPayoutReconciliationEvidence,
} from "@/lib/manual-tournament-payout-write-service";

const snapshotHash = "a".repeat(64);
const serverNow = "2026-08-01T10:00:00Z";
const importedCandidate: ImportedTournamentPrizeInput = {
  transactionId: "tx-1",
  occurredAt: "2026-07-30T10:00:00.000Z",
  tournamentId: "tournament-1",
  bracketId: null,
  stage: "final",
  assetCode: "USDC",
  amount: "10",
  externalReference: "receipt-1",
  aggregateStatus: "included",
};
const query = {
  tournamentId: "tournament-1",
  occurredAt: "2026-07-31T10:00:00.000Z",
  assetCode: "USDC",
  amount: "10",
  maximumCandidates: 250,
};

function hash(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function setHash(candidates: readonly ImportedTournamentPrizeInput[]): string {
  return hash({ activeImportSnapshotHash: snapshotHash, query, candidates });
}

const registry = {
  status: "ready" as const,
  version: "assets-v4",
  assets: [{ code: "USDC", kind: "crypto" as const, precision: 6 }],
};

const payoutInput = {
  payoutId: "payout-1",
  occurredAt: "2026-07-31T10:00:00Z",
  tournamentId: "tournament-1",
  stage: "final" as const,
  amount: "10.00",
  assetCode: "usdc",
  assetKind: "crypto" as const,
  assetDecimalPlaces: 6,
  externalReference: "receipt-1",
  allocationMethod: "vault_unallocated" as const,
};

type ReadyRepository = Extract<
  ManualTournamentPayoutWriteRepository,
  { status: "ready" }
>;

let saved: StoredManualTournamentPayout | null;
let candidates: ImportedTournamentPrizeInput[];
let candidateSetHash: string;
let repository: ReadyRepository;

function stateFingerprint(input: {
  payout: ManualTournamentPayout;
  reconciliation: TournamentPrizeReconciliation;
  reconciliationEvidence: TournamentPayoutReconciliationEvidence;
  revision: number;
  ledgerVersion: string;
  lastOperationFingerprint: string | null;
}): string {
  return hash(input);
}

function makeRepository(): ReadyRepository {
  return {
    status: "ready",
    loadTournamentCampaignBindingByOwner: vi.fn(async () => ({
      tournamentId: "tournament-1",
      evidenceId: "campaign-evidence-1",
      configurationVersion: "tournament-config-7",
      ownerAcknowledgedAt: "2026-07-29T10:00:00Z",
    })),
    loadImportedCandidateSetByOwner: vi.fn(async () => ({
      activeImportSnapshotHash: snapshotHash,
      candidateSetHash,
      candidates,
    })),
    savePayoutByOwner: vi.fn(
      async (_ownerId, payout, reconciliation, evidence) => {
        saved = {
          payout,
          reconciliation,
          reconciliationEvidence: evidence,
          stateFingerprint: stateFingerprint({
            payout,
            reconciliation,
            reconciliationEvidence: evidence,
            revision: 0,
            ledgerVersion: "ledger-2",
            lastOperationFingerprint: null,
          }),
          revision: 0,
          ledgerVersion: "ledger-2",
          lastOperationFingerprint: null,
        };
        return {
          status: "created" as const,
          ledgerVersion: "ledger-2",
          reconciliationRevision: 0,
        };
      },
    ),
    loadPayoutByOwner: vi.fn(async () => saved),
    saveReconciliationDecisionByOwner: vi.fn(
      async (_ownerId, input, fingerprint) => {
        if (saved === null) throw new Error("test setup missing payout");
        saved = {
          ...saved,
          reconciliation: input.reconciliation,
          reconciliationEvidence: input.reconciliationEvidence,
          revision: input.expectedRevision + 1,
          ledgerVersion: "ledger-3",
          lastOperationFingerprint: fingerprint,
          stateFingerprint: stateFingerprint({
            payout: saved.payout,
            reconciliation: input.reconciliation,
            reconciliationEvidence: input.reconciliationEvidence,
            revision: input.expectedRevision + 1,
            ledgerVersion: "ledger-3",
            lastOperationFingerprint: fingerprint,
          }),
        };
        return {
          status: "created" as const,
          ledgerVersion: "ledger-3",
          reconciliationRevision: input.expectedRevision + 1,
        };
      },
    ),
    reopenReconciliationReviewByOwner: vi.fn(
      async (_ownerId, input, fingerprint) => {
        if (saved === null) throw new Error("test setup missing payout");
        saved = {
          ...saved,
          reconciliation: input.reconciliation,
          reconciliationEvidence: input.reconciliationEvidence,
          revision: input.expectedRevision + 1,
          ledgerVersion: "ledger-3",
          lastOperationFingerprint: fingerprint,
          stateFingerprint: stateFingerprint({
            payout: saved.payout,
            reconciliation: input.reconciliation,
            reconciliationEvidence: input.reconciliationEvidence,
            revision: input.expectedRevision + 1,
            ledgerVersion: "ledger-3",
            lastOperationFingerprint: fingerprint,
          }),
        };
        return {
          status: "review_reopened" as const,
          ledgerVersion: "ledger-3",
          reconciliationRevision: input.expectedRevision + 1,
          candidateSet: {
            activeImportSnapshotHash: snapshotHash,
            candidateSetHash,
            candidates,
          },
        };
      },
    ),
  };
}

function recordInput() {
  return {
    authenticatedOwnerId: "owner-1",
    configuredOwnerId: "owner-1",
    repository,
    assetRegistry: registry,
    expectedAssetRegistryVersion: "assets-v4",
    expectedLedgerVersion: "ledger-1",
    expectedTournamentEvidenceId: "campaign-evidence-1",
    expectedTournamentConfigurationVersion: "tournament-config-7",
    expectedActiveImportSnapshotHash: snapshotHash,
    expectedCandidateSetHash: candidateSetHash,
    expectedCandidateTransactionIds: ["tx-1"],
    serverNow,
    payout: payoutInput,
  };
}

function decisionInput() {
  return {
    authenticatedOwnerId: "owner-1",
    configuredOwnerId: "owner-1",
    repository,
    assetRegistry: registry,
    expectedAssetRegistryVersion: "assets-v4",
    expectedActiveImportSnapshotHash: snapshotHash,
    expectedCandidateSetHash: candidateSetHash,
    expectedCandidateTransactionIds: candidates.map(
      (item) => item.transactionId,
    ),
    serverNow,
    payoutId: "payout-1",
    expectedRevision: 0,
    decision: {
      kind: "confirmed_duplicate" as const,
      importedTransactionId: "tx-1",
      decidedAt: "2026-08-01T09:00:00Z",
      reason: "Owner matched the imported receipt.",
    },
  };
}

beforeEach(() => {
  saved = null;
  candidates = [importedCandidate];
  candidateSetHash = setHash(candidates);
  repository = makeRepository();
});

describe("recordManualTournamentPayout", () => {
  it("fails closed before reading persistence without a connected owner", async () => {
    const result = await recordManualTournamentPayout({
      ...recordInput(),
      authenticatedOwnerId: null,
      repository: unavailableManualTournamentPayoutWriteRepository,
      assetRegistry: unavailableManualTournamentPayoutAssetRegistry,
    });
    expect(result).toEqual({ status: "identity_not_connected" });
  });

  it("denies a different owner before any economic repository read", async () => {
    await expect(
      recordManualTournamentPayout({
        ...recordInput(),
        authenticatedOwnerId: "different-owner",
      }),
    ).rejects.toThrow("access denied");
    expect(
      repository.loadTournamentCampaignBindingByOwner,
    ).not.toHaveBeenCalled();
    expect(repository.loadImportedCandidateSetByOwner).not.toHaveBeenCalled();
  });

  it("records exact campaign, registry, snapshot, candidate, and allocation evidence", async () => {
    const result = await recordManualTournamentPayout(recordInput());
    expect(result).toMatchObject({
      status: "recorded",
      ledgerVersion: "ledger-2",
      reconciliationStatus: "review_required",
      aggregateStatus: "included",
      candidateCount: 1,
      candidateSetHash,
      activeImportSnapshotHash: snapshotHash,
      allocationStatus: "vault_unallocated",
    });
    expect(repository.savePayoutByOwner).toHaveBeenCalledOnce();
    expect(saved?.payout).toMatchObject({
      assetCode: "USDC",
      assetRegistryVersion: "assets-v4",
      tournamentCampaignBinding: {
        evidenceId: "campaign-evidence-1",
        configurationVersion: "tournament-config-7",
      },
    });
  });

  it("rejects repository hash claims and owner-supplied evidence drift", async () => {
    candidateSetHash = "b".repeat(64);
    await expect(recordManualTournamentPayout(recordInput())).rejects.toThrow(
      "Repository candidate-set hash is invalid",
    );
    candidateSetHash = setHash(candidates);
    await expect(
      recordManualTournamentPayout({
        ...recordInput(),
        expectedCandidateTransactionIds: ["different"],
      }),
    ).rejects.toThrow("candidate evidence changed");
    expect(repository.savePayoutByOwner).not.toHaveBeenCalled();
  });

  it("rejects campaign, asset-registry, and ledger concurrency drift", async () => {
    await expect(
      recordManualTournamentPayout({
        ...recordInput(),
        expectedTournamentConfigurationVersion: "stale-config",
      }),
    ).rejects.toThrow("campaign binding changed");
    await expect(
      recordManualTournamentPayout({
        ...recordInput(),
        expectedAssetRegistryVersion: "stale-assets",
      }),
    ).rejects.toThrow("asset registry changed");
    vi.mocked(repository.savePayoutByOwner).mockResolvedValue({
      status: "version_conflict",
      ledgerVersion: "ledger-2",
      reconciliationRevision: 0,
    });
    await expect(recordManualTournamentPayout(recordInput())).rejects.toThrow(
      "ledger changed",
    );
  });

  it("recognizes exact idempotent replay but rejects durable identity conflict", async () => {
    const first = await recordManualTournamentPayout(recordInput());
    if (!("fingerprint" in first)) throw new Error("test setup failed");
    vi.mocked(repository.savePayoutByOwner).mockResolvedValue({
      status: "already_exists",
      fingerprint: first.fingerprint,
      ledgerVersion: "ledger-2",
      reconciliationRevision: 0,
    });
    await expect(
      recordManualTournamentPayout(recordInput()),
    ).resolves.toMatchObject({
      status: "replayed",
    });
    vi.mocked(repository.savePayoutByOwner).mockResolvedValue({
      status: "conflict",
      fingerprint: "different",
      ledgerVersion: "ledger-2",
      reconciliationRevision: 0,
    });
    await expect(recordManualTournamentPayout(recordInput())).rejects.toThrow(
      "durable identity conflicts",
    );
  });
});

describe("decideManualTournamentPayoutReconciliation", () => {
  it("persists a candidate-bound owner decision using optimistic revision", async () => {
    await recordManualTournamentPayout(recordInput());
    const result =
      await decideManualTournamentPayoutReconciliation(decisionInput());
    expect(result).toMatchObject({
      status: "recorded",
      reconciliationStatus: "confirmed_duplicate",
      aggregateStatus: "excluded",
      reconciliationRevision: 1,
    });
    expect(repository.saveReconciliationDecisionByOwner).toHaveBeenCalledOnce();
  });

  it("replays an exact decision retry after the first response was lost", async () => {
    await recordManualTournamentPayout(recordInput());
    const first =
      await decideManualTournamentPayoutReconciliation(decisionInput());
    const replay =
      await decideManualTournamentPayoutReconciliation(decisionInput());
    expect(first).toMatchObject({
      status: "recorded",
      reconciliationRevision: 1,
    });
    expect(replay).toMatchObject({
      status: "replayed",
      reconciliationRevision: 1,
      ledgerVersion: "ledger-3",
      reconciliationStatus: "confirmed_duplicate",
    });
    expect(repository.saveReconciliationDecisionByOwner).toHaveBeenCalledOnce();
  });

  it("rejects tampered stored state and stale revisions", async () => {
    await recordManualTournamentPayout(recordInput());
    if (saved === null) throw new Error("test setup failed");
    saved = { ...saved, stateFingerprint: "tampered" };
    await expect(
      decideManualTournamentPayoutReconciliation(decisionInput()),
    ).rejects.toThrow("fingerprint is invalid");
    await recordManualTournamentPayout(recordInput());
    await expect(
      decideManualTournamentPayoutReconciliation({
        ...decisionInput(),
        expectedRevision: 1,
      }),
    ).rejects.toThrow("revision is stale");
  });

  it("reopens review when the active import or candidate identities drift", async () => {
    await recordManualTournamentPayout(recordInput());
    candidates = [];
    candidateSetHash = setHash(candidates);
    const result =
      await decideManualTournamentPayoutReconciliation(decisionInput());
    expect(result).toMatchObject({
      status: "review_reopened",
      reconciliationStatus: "review_required",
      aggregateStatus: "included",
      candidateSetHash,
      activeImportSnapshotHash: snapshotHash,
      reconciliationRevision: 1,
    });
    expect(repository.reopenReconciliationReviewByOwner).toHaveBeenCalledOnce();
    expect(repository.saveReconciliationDecisionByOwner).not.toHaveBeenCalled();
  });

  it("replays the same review reopening without another write", async () => {
    await recordManualTournamentPayout(recordInput());
    candidates = [];
    candidateSetHash = setHash(candidates);
    await decideManualTournamentPayoutReconciliation(decisionInput());
    await expect(
      decideManualTournamentPayoutReconciliation(decisionInput()),
    ).resolves.toMatchObject({
      status: "review_reopened",
      reconciliationRevision: 1,
      ledgerVersion: "ledger-3",
    });
    expect(repository.reopenReconciliationReviewByOwner).toHaveBeenCalledOnce();
  });

  it("keeps a concurrent candidate drift fail-closed at the atomic write", async () => {
    await recordManualTournamentPayout(recordInput());
    const atomicCandidates: ImportedTournamentPrizeInput[] = [];
    const atomicCandidateSetHash = setHash(atomicCandidates);
    vi.mocked(repository.saveReconciliationDecisionByOwner).mockResolvedValue({
      status: "review_reopened",
      ledgerVersion: "ledger-3",
      reconciliationRevision: 1,
      candidateSet: {
        activeImportSnapshotHash: snapshotHash,
        candidateSetHash: atomicCandidateSetHash,
        candidates: atomicCandidates,
      },
    });
    await expect(
      decideManualTournamentPayoutReconciliation(decisionInput()),
    ).resolves.toMatchObject({
      status: "review_reopened",
      aggregateStatus: "included",
      reconciliationRevision: 1,
      candidateSetHash: atomicCandidateSetHash,
    });
  });

  it("rejects future decisions and stale expected candidate evidence", async () => {
    await recordManualTournamentPayout(recordInput());
    await expect(
      decideManualTournamentPayoutReconciliation({
        ...decisionInput(),
        decision: {
          ...decisionInput().decision,
          decidedAt: "2026-08-02T10:00:00Z",
        },
      }),
    ).rejects.toThrow("cannot be in the future");
    await expect(
      decideManualTournamentPayoutReconciliation({
        ...decisionInput(),
        expectedCandidateSetHash: "c".repeat(64),
      }),
    ).rejects.toThrow("candidate evidence changed");
  });

  it("requires the stored campaign binding to remain authoritative", async () => {
    await recordManualTournamentPayout(recordInput());
    vi.mocked(
      repository.loadTournamentCampaignBindingByOwner,
    ).mockResolvedValue({
      tournamentId: "tournament-1",
      evidenceId: "campaign-evidence-1",
      configurationVersion: "changed-config",
      ownerAcknowledgedAt: "2026-07-29T10:00:00Z",
    });
    await expect(
      decideManualTournamentPayoutReconciliation(decisionInput()),
    ).rejects.toThrow("campaign binding changed");
    expect(repository.saveReconciliationDecisionByOwner).not.toHaveBeenCalled();

    vi.mocked(
      repository.loadTournamentCampaignBindingByOwner,
    ).mockResolvedValue({
      tournamentId: "tournament-1",
      evidenceId: "campaign-evidence-1",
      configurationVersion: "tournament-config-7",
      ownerAcknowledgedAt: "2026-07-30T10:00:00Z",
    });
    await expect(
      decideManualTournamentPayoutReconciliation(decisionInput()),
    ).rejects.toThrow("campaign binding changed");
  });
});
