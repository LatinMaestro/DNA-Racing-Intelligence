import { createHash } from "node:crypto";
import { normalizeExactDecimal } from "@/domain/exact-decimal";
import {
  createManualTournamentPayout,
  type ManualTournamentPayout,
  type ManualTournamentPayoutInput,
  type TournamentPayoutAssetDefinition,
  type TournamentPayoutCampaignBinding,
} from "@/domain/manual-tournament-payout";
import {
  reconcileManualTournamentPrize,
  type ImportedTournamentPrizeInput,
  type TournamentPrizeReconciliation,
  type TournamentPrizeReconciliationDecision,
} from "@/domain/tournament-prize-reconciliation";

const maximumCandidateCount = 250;
const sha256Pattern = /^[0-9a-f]{64}$/;

export type ManualTournamentPayoutAssetRegistry =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      version: string;
      assets: readonly TournamentPayoutAssetDefinition[];
    }>;

export type TournamentPayoutCandidateSet = Readonly<{
  activeImportSnapshotHash: string;
  candidateSetHash: string;
  candidates: readonly ImportedTournamentPrizeInput[];
}>;

export type TournamentPayoutReconciliationEvidence = Readonly<{
  activeImportSnapshotHash: string;
  candidateSetHash: string;
  candidateTransactionIds: readonly string[];
}>;

export type ManualTournamentPayoutPersistenceResult =
  | Readonly<{
      status: "created";
      ledgerVersion: string;
      reconciliationRevision: number;
    }>
  | Readonly<{
      status: "already_exists";
      fingerprint: string;
      ledgerVersion: string;
      reconciliationRevision: number;
    }>
  | Readonly<{
      status: "conflict";
      fingerprint: string;
      ledgerVersion: string;
      reconciliationRevision: number;
    }>
  | Readonly<{
      status: "version_conflict";
      ledgerVersion: string;
      reconciliationRevision: number;
    }>
  | Readonly<{
      status: "revision_conflict" | "evidence_conflict";
      ledgerVersion: string;
      reconciliationRevision: number;
    }>
  | Readonly<{
      status: "review_reopened";
      ledgerVersion: string;
      reconciliationRevision: number;
      candidateSet: TournamentPayoutCandidateSet;
    }>;

export type StoredManualTournamentPayout = Readonly<{
  payout: ManualTournamentPayout;
  stateFingerprint: string;
  reconciliation: TournamentPrizeReconciliation;
  reconciliationEvidence: TournamentPayoutReconciliationEvidence;
  revision: number;
  ledgerVersion: string;
  lastOperationFingerprint: string | null;
}>;

export type ManualTournamentPayoutWriteRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadTournamentCampaignBindingByOwner: (
        ownerId: string,
        tournamentId: string,
      ) => Promise<TournamentPayoutCampaignBinding | null>;
      loadImportedCandidateSetByOwner: (
        ownerId: string,
        query: Readonly<{
          tournamentId: string;
          occurredAt: string;
          assetCode: string;
          amount: string;
          maximumCandidates: number;
        }>,
      ) => Promise<TournamentPayoutCandidateSet>;
      savePayoutByOwner: (
        ownerId: string,
        payout: ManualTournamentPayout,
        reconciliation: TournamentPrizeReconciliation,
        evidence: TournamentPayoutReconciliationEvidence,
        fingerprint: string,
        expectedLedgerVersion: string,
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
          reconciliationEvidence: TournamentPayoutReconciliationEvidence;
        }>,
        fingerprint: string,
      ) => Promise<ManualTournamentPayoutPersistenceResult>;
      reopenReconciliationReviewByOwner: (
        ownerId: string,
        input: Readonly<{
          payoutId: string;
          expectedRevision: number;
          reconciliation: TournamentPrizeReconciliation;
          reconciliationEvidence: TournamentPayoutReconciliationEvidence;
          reason: "candidate_evidence_drift";
        }>,
        fingerprint: string,
      ) => Promise<ManualTournamentPayoutPersistenceResult>;
    }>;

type DurableResult = Readonly<{
  status: "recorded" | "replayed";
  ledgerVersion: string;
  reconciliationRevision: number;
}>;

export type ManualTournamentPayoutWriteResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "asset_registry_not_configured" }>
  | (DurableResult &
      Readonly<{
        payoutId: string;
        fingerprint: string;
        reconciliationStatus: TournamentPrizeReconciliation["status"];
        aggregateStatus: TournamentPrizeReconciliation["manualPayoutAggregateStatus"];
        candidateCount: number;
        candidateSetHash: string;
        activeImportSnapshotHash: string;
        allocationStatus: ManualTournamentPayout["allocationStatus"];
      }>);

export type ManualTournamentPayoutDecisionResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "persistence_not_configured" }>
  | Readonly<{ status: "asset_registry_not_configured" }>
  | (DurableResult &
      Readonly<{
        payoutId: string;
        fingerprint: string;
        reconciliationStatus: Extract<
          TournamentPrizeReconciliation["status"],
          "confirmed_duplicate" | "confirmed_separate"
        >;
        aggregateStatus: TournamentPrizeReconciliation["manualPayoutAggregateStatus"];
      }>)
  | Readonly<{
      status: "review_reopened";
      payoutId: string;
      fingerprint: string;
      ledgerVersion: string;
      reconciliationRevision: number;
      reconciliationStatus: "review_required";
      aggregateStatus: "included";
      candidateSetHash: string;
      activeImportSnapshotHash: string;
    }>;

export const unavailableManualTournamentPayoutWriteRepository: ManualTournamentPayoutWriteRepository =
  Object.freeze({ status: "not_configured" });
export const unavailableManualTournamentPayoutAssetRegistry: ManualTournamentPayoutAssetRegistry =
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
  const parsed = new Date(required(value, label));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be valid.`);
  }
  return parsed.toISOString();
}

function sha256(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requiredHash(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!sha256Pattern.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 hash.`);
  }
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
    throw new Error("Manual tournament payout write access denied.");
  }
  return authenticatedOwnerId;
}

function readyAssetRegistry(input: {
  registry: ManualTournamentPayoutAssetRegistry;
  expectedVersion: string;
}): Extract<ManualTournamentPayoutAssetRegistry, { status: "ready" }> | null {
  if (input.registry.status === "not_configured") return null;
  if (
    required(input.expectedVersion, "Expected asset registry version") !==
    required(input.registry.version, "Asset registry version")
  ) {
    throw new Error(
      "Tournament payout asset registry changed; review is required.",
    );
  }
  return input.registry;
}

function assetDefinition(
  registry: Extract<ManualTournamentPayoutAssetRegistry, { status: "ready" }>,
  suppliedCode: string,
): TournamentPayoutAssetDefinition {
  const code = suppliedCode.trim().toUpperCase();
  const matches = registry.assets.filter(
    (asset) => asset.code.trim().toUpperCase() === code,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Tournament payout asset is not in the authoritative registry."
        : "Authoritative tournament payout asset registry is ambiguous.",
    );
  }
  return matches[0]!;
}

function normalizedCandidateIds(values: readonly string[]): string[] {
  const normalized = values.map((value) =>
    required(value, "Candidate transaction ID"),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Expected candidate transaction IDs must be unique.");
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function canonicalCandidates(
  candidates: readonly ImportedTournamentPrizeInput[],
  serverNow: string,
): ImportedTournamentPrizeInput[] {
  if (candidates.length > maximumCandidateCount) {
    throw new Error(
      "Tournament payout candidate set exceeds the bounded limit.",
    );
  }
  const canonical = candidates.map((candidate) => {
    const occurredAt = canonicalTimestamp(
      candidate.occurredAt,
      "Imported payout timestamp",
    );
    if (Date.parse(occurredAt) > Date.parse(serverNow)) {
      throw new Error("Imported payout candidate cannot be in the future.");
    }
    const amount = normalizeExactDecimal(candidate.amount);
    if (amount === "0" || amount.startsWith("-")) {
      throw new Error("Imported tournament payout amount must be positive.");
    }
    if (
      !["qualification", "round", "final", "unknown"].includes(candidate.stage)
    ) {
      throw new Error("Imported tournament payout stage is invalid.");
    }
    if (!["included", "excluded"].includes(candidate.aggregateStatus)) {
      throw new Error(
        "Imported tournament payout aggregate status is invalid.",
      );
    }
    return {
      transactionId: required(
        candidate.transactionId,
        "Imported transaction ID",
      ),
      occurredAt,
      tournamentId: candidate.tournamentId?.trim() || null,
      bracketId: candidate.bracketId?.trim() || null,
      stage: candidate.stage,
      assetCode: required(
        candidate.assetCode,
        "Imported asset code",
      ).toUpperCase(),
      amount,
      externalReference: candidate.externalReference?.trim() || null,
      aggregateStatus: candidate.aggregateStatus,
    };
  });
  canonical.sort((left, right) =>
    left.transactionId.localeCompare(right.transactionId),
  );
  if (
    new Set(canonical.map((item) => item.transactionId)).size !==
    canonical.length
  ) {
    throw new Error("Imported tournament transaction IDs must be unique.");
  }
  return canonical;
}

function candidateQuery(payout: ManualTournamentPayout) {
  return {
    tournamentId: payout.tournamentId,
    occurredAt: payout.occurredAt,
    assetCode: payout.assetCode,
    amount: payout.amount,
    maximumCandidates: maximumCandidateCount,
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

async function campaignBinding(input: {
  repository: Extract<
    ManualTournamentPayoutWriteRepository,
    { status: "ready" }
  >;
  ownerId: string;
  tournamentId: string;
  expectedEvidenceId: string;
  expectedConfigurationVersion: string;
  expectedOwnerAcknowledgedAt?: string;
  serverNow: string;
}): Promise<TournamentPayoutCampaignBinding> {
  const tournamentId = required(input.tournamentId, "Tournament ID");
  const expectedEvidenceId = required(
    input.expectedEvidenceId,
    "Expected tournament campaign evidence ID",
  );
  const expectedConfigurationVersion = required(
    input.expectedConfigurationVersion,
    "Expected tournament configuration version",
  );
  const persisted = await input.repository.loadTournamentCampaignBindingByOwner(
    input.ownerId,
    tournamentId,
  );
  const persistedTournamentId =
    persisted === null
      ? null
      : required(persisted.tournamentId, "Persisted tournament ID");
  const persistedEvidenceId =
    persisted === null
      ? null
      : required(
          persisted.evidenceId,
          "Persisted tournament campaign evidence ID",
        );
  const persistedConfigurationVersion =
    persisted === null
      ? null
      : required(
          persisted.configurationVersion,
          "Persisted tournament configuration version",
        );
  if (
    persisted === null ||
    persistedTournamentId !== tournamentId ||
    persistedEvidenceId !== expectedEvidenceId ||
    persistedConfigurationVersion !== expectedConfigurationVersion
  ) {
    throw new Error("Tournament campaign binding changed; review is required.");
  }
  const ownerAcknowledgedAt = canonicalTimestamp(
    persisted.ownerAcknowledgedAt,
    "Tournament owner acknowledgement",
  );
  if (Date.parse(ownerAcknowledgedAt) > Date.parse(input.serverNow)) {
    throw new Error(
      "Tournament owner acknowledgement cannot be in the future.",
    );
  }
  if (
    input.expectedOwnerAcknowledgedAt !== undefined &&
    ownerAcknowledgedAt !==
      canonicalTimestamp(
        input.expectedOwnerAcknowledgedAt,
        "Expected tournament owner acknowledgement",
      )
  ) {
    throw new Error("Tournament campaign binding changed; review is required.");
  }
  return {
    tournamentId: persistedTournamentId,
    evidenceId: persistedEvidenceId,
    configurationVersion: persistedConfigurationVersion,
    ownerAcknowledgedAt,
  };
}

async function candidateEvidence(input: {
  repository: Extract<
    ManualTournamentPayoutWriteRepository,
    { status: "ready" }
  >;
  ownerId: string;
  payout: ManualTournamentPayout;
  serverNow: string;
}): Promise<
  Readonly<{
    evidence: TournamentPayoutReconciliationEvidence;
    candidates: readonly ImportedTournamentPrizeInput[];
  }>
> {
  const returned = await input.repository.loadImportedCandidateSetByOwner(
    input.ownerId,
    candidateQuery(input.payout),
  );
  return validatedCandidateSet(returned, input.payout, input.serverNow);
}

function validatedCandidateSet(
  returned: TournamentPayoutCandidateSet,
  payout: ManualTournamentPayout,
  serverNow: string,
): Readonly<{
  evidence: TournamentPayoutReconciliationEvidence;
  candidates: readonly ImportedTournamentPrizeInput[];
}> {
  const activeImportSnapshotHash = requiredHash(
    returned.activeImportSnapshotHash,
    "Active import snapshot hash",
  );
  const candidates = canonicalCandidates(returned.candidates, serverNow);
  const candidateSetHash = sha256({
    activeImportSnapshotHash,
    query: candidateQuery(payout),
    candidates,
  });
  if (
    requiredHash(returned.candidateSetHash, "Candidate-set hash") !==
    candidateSetHash
  ) {
    throw new Error("Repository candidate-set hash is invalid.");
  }
  return {
    candidates,
    evidence: {
      activeImportSnapshotHash,
      candidateSetHash,
      candidateTransactionIds: candidates.map(
        (candidate) => candidate.transactionId,
      ),
    },
  };
}

function assertExpectedEvidence(
  actual: TournamentPayoutReconciliationEvidence,
  expected: Readonly<{
    activeImportSnapshotHash: string;
    candidateSetHash: string;
    candidateTransactionIds: readonly string[];
  }>,
): void {
  const expectedIds = normalizedCandidateIds(expected.candidateTransactionIds);
  if (
    actual.activeImportSnapshotHash !==
      requiredHash(
        expected.activeImportSnapshotHash,
        "Expected active import snapshot hash",
      ) ||
    actual.candidateSetHash !==
      requiredHash(expected.candidateSetHash, "Expected candidate-set hash") ||
    JSON.stringify(actual.candidateTransactionIds) !==
      JSON.stringify(expectedIds)
  ) {
    throw new Error(
      "Tournament payout candidate evidence changed; review is required.",
    );
  }
}

function sameEvidence(
  left: TournamentPayoutReconciliationEvidence,
  right: TournamentPayoutReconciliationEvidence,
): boolean {
  return (
    left.activeImportSnapshotHash === right.activeImportSnapshotHash &&
    left.candidateSetHash === right.candidateSetHash &&
    JSON.stringify(left.candidateTransactionIds) ===
      JSON.stringify(right.candidateTransactionIds)
  );
}

function sameReconciliation(
  left: TournamentPrizeReconciliation,
  right: TournamentPrizeReconciliation,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function resolvedStatus(
  result: ManualTournamentPayoutPersistenceResult,
  expectedFingerprint: string,
): DurableResult {
  if (result.status === "created") {
    return {
      status: "recorded",
      ledgerVersion: required(result.ledgerVersion, "Ledger version"),
      reconciliationRevision: validRevision(
        result.reconciliationRevision,
        "Reconciliation revision",
      ),
    };
  }
  if (
    result.status === "already_exists" &&
    result.fingerprint === expectedFingerprint
  ) {
    return {
      status: "replayed",
      ledgerVersion: required(result.ledgerVersion, "Ledger version"),
      reconciliationRevision: validRevision(
        result.reconciliationRevision,
        "Reconciliation revision",
      ),
    };
  }
  if (result.status === "version_conflict") {
    throw new Error(
      "Manual tournament payout ledger changed; refresh before recording.",
    );
  }
  if (result.status === "revision_conflict") {
    throw new Error(
      "Manual tournament payout reconciliation revision is stale.",
    );
  }
  if (result.status === "evidence_conflict") {
    throw new Error(
      "Tournament payout candidate evidence changed; review is required.",
    );
  }
  throw new Error(
    "Manual tournament payout durable identity conflicts with prior evidence.",
  );
}

function normalizeDecision(
  decision: TournamentPrizeReconciliationDecision,
  serverNow: string,
): TournamentPrizeReconciliationDecision {
  const decidedAt = canonicalTimestamp(
    decision.decidedAt,
    "Reconciliation decision timestamp",
  );
  if (Date.parse(decidedAt) > Date.parse(serverNow)) {
    throw new Error("Reconciliation decision cannot be in the future.");
  }
  const reason = required(decision.reason, "Reconciliation decision reason");
  if (decision.kind === "confirmed_duplicate") {
    return {
      kind: "confirmed_duplicate",
      importedTransactionId: required(
        decision.importedTransactionId,
        "Imported transaction ID",
      ),
      decidedAt,
      reason,
    };
  }
  if (decision.kind !== "confirmed_separate") {
    throw new Error("Tournament prize reconciliation decision is invalid.");
  }
  return { kind: "confirmed_separate", decidedAt, reason };
}

function reopenedReconciliation(
  payout: ManualTournamentPayout,
  candidates: readonly ImportedTournamentPrizeInput[],
): TournamentPrizeReconciliation {
  const current = reconcileManualTournamentPrize(
    reconciliationInput(payout),
    candidates,
  );
  return {
    ...current,
    status: "review_required",
    manualPayoutAggregateStatus: "included",
    duplicateOfImportedTransactionId: null,
    warnings: [
      ...new Set([...current.warnings, "REVIEW_DECISION_REQUIRED" as const]),
    ],
  };
}

export async function recordManualTournamentPayout(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualTournamentPayoutWriteRepository;
  assetRegistry: ManualTournamentPayoutAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedLedgerVersion: string;
  expectedTournamentEvidenceId: string;
  expectedTournamentConfigurationVersion: string;
  expectedActiveImportSnapshotHash: string;
  expectedCandidateSetHash: string;
  expectedCandidateTransactionIds: readonly string[];
  serverNow: string;
  payout: ManualTournamentPayoutInput;
}): Promise<ManualTournamentPayoutWriteResult> {
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
  const serverNow = canonicalTimestamp(input.serverNow, "Server time");
  const binding = await campaignBinding({
    repository: input.repository,
    ownerId,
    tournamentId: input.payout.tournamentId,
    expectedEvidenceId: input.expectedTournamentEvidenceId,
    expectedConfigurationVersion: input.expectedTournamentConfigurationVersion,
    serverNow,
  });
  const payout = createManualTournamentPayout(input.payout, {
    serverNow,
    assetDefinition: assetDefinition(registry, input.payout.assetCode),
    assetRegistryVersion: required(registry.version, "Asset registry version"),
    tournamentCampaignBinding: binding,
  });
  const current = await candidateEvidence({
    repository: input.repository,
    ownerId,
    payout,
    serverNow,
  });
  assertExpectedEvidence(current.evidence, {
    activeImportSnapshotHash: input.expectedActiveImportSnapshotHash,
    candidateSetHash: input.expectedCandidateSetHash,
    candidateTransactionIds: input.expectedCandidateTransactionIds,
  });
  const reconciliation = reconcileManualTournamentPrize(
    reconciliationInput(payout),
    current.candidates,
  );
  const payoutFingerprint = sha256({
    payout,
    reconciliation,
    reconciliationEvidence: current.evidence,
  });
  const resolved = resolvedStatus(
    await input.repository.savePayoutByOwner(
      ownerId,
      payout,
      reconciliation,
      current.evidence,
      payoutFingerprint,
      required(input.expectedLedgerVersion, "Expected ledger version"),
    ),
    payoutFingerprint,
  );
  return {
    ...resolved,
    payoutId: payout.payoutId,
    fingerprint: payoutFingerprint,
    reconciliationStatus: reconciliation.status,
    aggregateStatus: reconciliation.manualPayoutAggregateStatus,
    candidateCount: current.candidates.length,
    candidateSetHash: current.evidence.candidateSetHash,
    activeImportSnapshotHash: current.evidence.activeImportSnapshotHash,
    allocationStatus: payout.allocationStatus,
  };
}

export async function decideManualTournamentPayoutReconciliation(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ManualTournamentPayoutWriteRepository;
  assetRegistry: ManualTournamentPayoutAssetRegistry;
  expectedAssetRegistryVersion: string;
  expectedActiveImportSnapshotHash: string;
  expectedCandidateSetHash: string;
  expectedCandidateTransactionIds: readonly string[];
  serverNow: string;
  payoutId: string;
  expectedRevision: number;
  decision: TournamentPrizeReconciliationDecision;
}): Promise<ManualTournamentPayoutDecisionResult> {
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
  const serverNow = canonicalTimestamp(input.serverNow, "Server time");
  const payoutId = required(input.payoutId, "Manual payout ID");
  const expectedRevision = validRevision(
    input.expectedRevision,
    "Expected reconciliation revision",
  );
  const stored = await input.repository.loadPayoutByOwner(ownerId, payoutId);
  if (stored === null) {
    throw new Error("Manual tournament payout was not found.");
  }
  if (stored.payout.payoutId !== payoutId) {
    throw new Error("Stored manual tournament payout identity is invalid.");
  }
  validRevision(stored.revision, "Stored reconciliation revision");
  const storedLedgerVersion = required(stored.ledgerVersion, "Ledger version");
  const lastOperationFingerprint =
    stored.lastOperationFingerprint === null
      ? null
      : requiredHash(
          stored.lastOperationFingerprint,
          "Last operation fingerprint",
        );
  if (
    sha256({
      payout: stored.payout,
      reconciliation: stored.reconciliation,
      reconciliationEvidence: stored.reconciliationEvidence,
      revision: stored.revision,
      ledgerVersion: storedLedgerVersion,
      lastOperationFingerprint,
    }) !== stored.stateFingerprint
  ) {
    throw new Error("Stored manual tournament payout fingerprint is invalid.");
  }
  await campaignBinding({
    repository: input.repository,
    ownerId,
    tournamentId: stored.payout.tournamentId,
    expectedEvidenceId: stored.payout.tournamentCampaignBinding.evidenceId,
    expectedConfigurationVersion:
      stored.payout.tournamentCampaignBinding.configurationVersion,
    expectedOwnerAcknowledgedAt:
      stored.payout.tournamentCampaignBinding.ownerAcknowledgedAt,
    serverNow,
  });
  const definition = assetDefinition(registry, stored.payout.assetCode);
  if (
    stored.payout.assetKind !== definition.kind ||
    stored.payout.assetDecimalPlaces !== definition.precision ||
    stored.payout.assetRegistryVersion !==
      required(registry.version, "Asset registry version")
  ) {
    throw new Error(
      "Stored tournament payout asset registry evidence drifted; review is required.",
    );
  }
  const current = await candidateEvidence({
    repository: input.repository,
    ownerId,
    payout: stored.payout,
    serverNow,
  });
  const reopened = reopenedReconciliation(stored.payout, current.candidates);
  const durableReopen = {
    payoutId,
    expectedRevision,
    reconciliation: reopened,
    reconciliationEvidence: current.evidence,
    reason: "candidate_evidence_drift" as const,
  };
  const reopenFingerprint = sha256(durableReopen);
  if (
    stored.revision === expectedRevision + 1 &&
    lastOperationFingerprint === reopenFingerprint &&
    sameEvidence(stored.reconciliationEvidence, current.evidence) &&
    sameReconciliation(stored.reconciliation, reopened)
  ) {
    return {
      status: "review_reopened",
      payoutId,
      fingerprint: reopenFingerprint,
      ledgerVersion: storedLedgerVersion,
      reconciliationRevision: stored.revision,
      reconciliationStatus: "review_required",
      aggregateStatus: "included",
      candidateSetHash: current.evidence.candidateSetHash,
      activeImportSnapshotHash: current.evidence.activeImportSnapshotHash,
    };
  }
  if (!sameEvidence(stored.reconciliationEvidence, current.evidence)) {
    if (stored.revision !== expectedRevision) {
      throw new Error(
        "Manual tournament payout reconciliation revision is stale.",
      );
    }
    const result = await input.repository.reopenReconciliationReviewByOwner(
      ownerId,
      durableReopen,
      reopenFingerprint,
    );
    if (result.status !== "review_reopened") {
      resolvedStatus(result, reopenFingerprint);
      throw new Error("Tournament payout review could not be reopened.");
    }
    const finalCandidateSet = validatedCandidateSet(
      result.candidateSet,
      stored.payout,
      serverNow,
    );
    return {
      status: "review_reopened",
      payoutId,
      fingerprint: reopenFingerprint,
      ledgerVersion: required(result.ledgerVersion, "Ledger version"),
      reconciliationRevision: validRevision(
        result.reconciliationRevision,
        "Reconciliation revision",
      ),
      reconciliationStatus: "review_required",
      aggregateStatus: "included",
      candidateSetHash: finalCandidateSet.evidence.candidateSetHash,
      activeImportSnapshotHash:
        finalCandidateSet.evidence.activeImportSnapshotHash,
    };
  }
  assertExpectedEvidence(current.evidence, {
    activeImportSnapshotHash: input.expectedActiveImportSnapshotHash,
    candidateSetHash: input.expectedCandidateSetHash,
    candidateTransactionIds: input.expectedCandidateTransactionIds,
  });
  const decision = normalizeDecision(input.decision, serverNow);
  const reconciliation = reconcileManualTournamentPrize(
    reconciliationInput(stored.payout),
    current.candidates,
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
    expectedRevision,
    decision,
    reconciliation,
    reconciliationEvidence: current.evidence,
  } as const;
  const decisionFingerprint = sha256(durableDecision);
  if (
    stored.revision === expectedRevision + 1 &&
    lastOperationFingerprint === decisionFingerprint &&
    sameReconciliation(stored.reconciliation, reconciliation)
  ) {
    return {
      status: "replayed",
      payoutId,
      fingerprint: decisionFingerprint,
      ledgerVersion: storedLedgerVersion,
      reconciliationRevision: stored.revision,
      reconciliationStatus: reconciliation.status,
      aggregateStatus: reconciliation.manualPayoutAggregateStatus,
    };
  }
  if (stored.revision !== expectedRevision) {
    throw new Error(
      "Manual tournament payout reconciliation revision is stale.",
    );
  }
  const result = await input.repository.saveReconciliationDecisionByOwner(
    ownerId,
    durableDecision,
    decisionFingerprint,
  );
  if (result.status === "review_reopened") {
    const finalCandidateSet = validatedCandidateSet(
      result.candidateSet,
      stored.payout,
      serverNow,
    );
    return {
      status: "review_reopened",
      payoutId,
      fingerprint: decisionFingerprint,
      ledgerVersion: required(result.ledgerVersion, "Ledger version"),
      reconciliationRevision: validRevision(
        result.reconciliationRevision,
        "Reconciliation revision",
      ),
      reconciliationStatus: "review_required",
      aggregateStatus: "included",
      candidateSetHash: finalCandidateSet.evidence.candidateSetHash,
      activeImportSnapshotHash:
        finalCandidateSet.evidence.activeImportSnapshotHash,
    };
  }
  const resolved = resolvedStatus(result, decisionFingerprint);
  return {
    ...resolved,
    payoutId,
    fingerprint: decisionFingerprint,
    reconciliationStatus: reconciliation.status,
    aggregateStatus: reconciliation.manualPayoutAggregateStatus,
  };
}
