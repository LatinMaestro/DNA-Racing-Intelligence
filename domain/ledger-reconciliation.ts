import {
  isZeroExactDecimal,
  negateExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";

export const ledgerSourceTypes = [
  "race_import",
  "manual_entry",
  "manual_tournament_payout",
  "authoritative_export",
  "reversal",
] as const;
export type LedgerSourceType = (typeof ledgerSourceTypes)[number];

export const reconciliationActionTypes = [
  "exclude",
  "restore",
  "mark_duplicate",
  "reverse",
] as const;
export type ReconciliationActionType =
  (typeof reconciliationActionTypes)[number];

export type LedgerEvidenceInput = {
  transactionId: string;
  sourceType: LedgerSourceType;
  occurredAt: string;
  assetCode: string;
  signedAmount: string;
  category: string;
  subcategory: string;
  sourceStableKey?: string | null;
  externalReference?: string | null;
  tournamentId?: string | null;
  coreIds?: readonly string[];
};

export type NormalizedLedgerEvidence = {
  transactionId: string;
  sourceType: LedgerSourceType;
  occurredAt: string;
  utcDate: string;
  assetCode: string;
  signedAmount: string;
  category: string;
  subcategory: string;
  sourceStableKey: string | null;
  externalReference: string | null;
  tournamentId: string | null;
  coreIds: readonly string[];
};

export type DuplicateCandidateReason =
  | "SAME_SOURCE_STABLE_KEY"
  | "SAME_EXTERNAL_REFERENCE"
  | "SAME_DATE_AMOUNT_AND_CONTEXT"
  | "SAME_DATE_AND_AMOUNT";

export type DuplicateCandidate = {
  candidateId: string;
  firstTransactionId: string;
  secondTransactionId: string;
  reasons: readonly DuplicateCandidateReason[];
  reviewPriority: "high" | "medium" | "low";
  automaticExclusionAllowed: false;
};

export type ReconciliationActionInput = {
  actionId: string;
  actionType: ReconciliationActionType;
  targetTransactionId: string;
  recordedAt: string;
  reason: string;
  survivingTransactionId?: string | null;
  reversalTransactionId?: string | null;
};

export type ReconciliationAction = {
  actionId: string;
  actionType: ReconciliationActionType;
  targetTransactionId: string;
  recordedAt: string;
  reason: string;
  survivingTransactionId: string | null;
  reversalTransactionId: string | null;
};

export type ReconciledTransaction = {
  transaction: NormalizedLedgerEvidence;
  aggregateStatus: "included" | "excluded";
  exclusionReason: "manual_exclusion" | "confirmed_duplicate" | null;
  survivingTransactionId: string | null;
  reversedByTransactionId: string | null;
};

export type ReconciliationResult = {
  transactions: readonly ReconciledTransaction[];
  generatedReversals: readonly NormalizedLedgerEvidence[];
  auditActions: readonly ReconciliationAction[];
};

const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;

function requiredTrimmed(
  value: string | null | undefined,
  label: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function normalizeTimestamp(value: string, label: string): string {
  const trimmed = requiredTrimmed(value, label);
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) throw new Error(`${label} must be valid.`);
  return new Date(timestamp).toISOString();
}

function normalizeCoreIds(coreIds: readonly string[] | undefined): string[] {
  const normalized = (coreIds ?? []).map((coreId) =>
    requiredTrimmed(coreId, "Core ID"),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Ledger evidence core IDs must be unique.");
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

export function normalizeLedgerEvidence(
  input: LedgerEvidenceInput,
): NormalizedLedgerEvidence {
  if (!ledgerSourceTypes.includes(input.sourceType)) {
    throw new Error("Ledger source type is invalid.");
  }

  const occurredAt = normalizeTimestamp(input.occurredAt, "Occurred at");
  const assetCode = input.assetCode.trim().toUpperCase();
  if (!assetCodePattern.test(assetCode)) {
    throw new Error("Ledger asset identity is invalid.");
  }

  let signedAmount: string;
  try {
    signedAmount = normalizeExactDecimal(input.signedAmount);
  } catch {
    throw new Error("Ledger amount must be a plain base-10 decimal.");
  }
  if (isZeroExactDecimal(signedAmount)) {
    throw new Error("Ledger evidence cannot use a zero amount.");
  }

  return {
    transactionId: requiredTrimmed(input.transactionId, "Transaction ID"),
    sourceType: input.sourceType,
    occurredAt,
    utcDate: occurredAt.slice(0, 10),
    assetCode,
    signedAmount,
    category: requiredTrimmed(input.category, "Category"),
    subcategory: requiredTrimmed(input.subcategory, "Subcategory"),
    sourceStableKey: optionalTrimmed(input.sourceStableKey),
    externalReference: optionalTrimmed(input.externalReference),
    tournamentId: optionalTrimmed(input.tournamentId),
    coreIds: normalizeCoreIds(input.coreIds),
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function duplicateReasons(
  first: NormalizedLedgerEvidence,
  second: NormalizedLedgerEvidence,
): DuplicateCandidateReason[] {
  if (
    first.assetCode !== second.assetCode ||
    first.signedAmount !== second.signedAmount
  ) {
    return [];
  }

  const reasons: DuplicateCandidateReason[] = [];
  if (
    first.sourceStableKey !== null &&
    first.sourceStableKey === second.sourceStableKey
  ) {
    reasons.push("SAME_SOURCE_STABLE_KEY");
  }
  if (
    first.externalReference !== null &&
    first.externalReference === second.externalReference
  ) {
    reasons.push("SAME_EXTERNAL_REFERENCE");
  }
  if (first.utcDate === second.utcDate) {
    const sameContext =
      first.category === second.category &&
      first.subcategory === second.subcategory &&
      first.tournamentId === second.tournamentId &&
      sameArray(first.coreIds, second.coreIds);
    reasons.push(
      sameContext ? "SAME_DATE_AMOUNT_AND_CONTEXT" : "SAME_DATE_AND_AMOUNT",
    );
  }
  return reasons;
}

function candidatePriority(
  reasons: readonly DuplicateCandidateReason[],
): DuplicateCandidate["reviewPriority"] {
  if (
    reasons.includes("SAME_SOURCE_STABLE_KEY") ||
    reasons.includes("SAME_EXTERNAL_REFERENCE")
  ) {
    return "high";
  }
  return reasons.includes("SAME_DATE_AMOUNT_AND_CONTEXT") ? "medium" : "low";
}

export function detectDuplicateCandidates(
  inputs: readonly LedgerEvidenceInput[],
): DuplicateCandidate[] {
  const transactions = inputs
    .map(normalizeLedgerEvidence)
    .sort((left, right) =>
      left.transactionId.localeCompare(right.transactionId),
    );
  if (
    new Set(transactions.map(({ transactionId }) => transactionId)).size !==
    transactions.length
  ) {
    throw new Error("Ledger transaction IDs must be unique.");
  }

  const candidates: DuplicateCandidate[] = [];
  for (let firstIndex = 0; firstIndex < transactions.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < transactions.length;
      secondIndex += 1
    ) {
      const first = transactions[firstIndex];
      const second = transactions[secondIndex];
      if (first === undefined || second === undefined) continue;
      const reasons = duplicateReasons(first, second);
      if (reasons.length === 0) continue;
      candidates.push({
        candidateId: `${first.transactionId}::${second.transactionId}`,
        firstTransactionId: first.transactionId,
        secondTransactionId: second.transactionId,
        reasons,
        reviewPriority: candidatePriority(reasons),
        automaticExclusionAllowed: false,
      });
    }
  }
  return candidates;
}

function normalizeAction(
  input: ReconciliationActionInput,
): ReconciliationAction {
  if (!reconciliationActionTypes.includes(input.actionType)) {
    throw new Error("Reconciliation action type is invalid.");
  }
  const survivingTransactionId = optionalTrimmed(input.survivingTransactionId);
  const reversalTransactionId = optionalTrimmed(input.reversalTransactionId);
  if (
    input.actionType === "mark_duplicate" &&
    survivingTransactionId === null
  ) {
    throw new Error("A duplicate action requires the surviving transaction.");
  }
  if (
    input.actionType !== "mark_duplicate" &&
    survivingTransactionId !== null
  ) {
    throw new Error(
      "Only a duplicate action may name a surviving transaction.",
    );
  }
  if (input.actionType === "reverse" && reversalTransactionId === null) {
    throw new Error("A reversal action requires a reversal transaction ID.");
  }
  if (input.actionType !== "reverse" && reversalTransactionId !== null) {
    throw new Error("Only a reversal action may name a reversal transaction.");
  }
  return {
    actionId: requiredTrimmed(input.actionId, "Action ID"),
    actionType: input.actionType,
    targetTransactionId: requiredTrimmed(
      input.targetTransactionId,
      "Target transaction ID",
    ),
    recordedAt: normalizeTimestamp(input.recordedAt, "Action recorded at"),
    reason: requiredTrimmed(input.reason, "Action reason"),
    survivingTransactionId,
    reversalTransactionId,
  };
}

export function reconcileLedger(
  transactionInputs: readonly LedgerEvidenceInput[],
  actionInputs: readonly ReconciliationActionInput[],
): ReconciliationResult {
  const transactions = transactionInputs.map(normalizeLedgerEvidence);
  const transactionById = new Map(
    transactions.map((transaction) => [transaction.transactionId, transaction]),
  );
  if (transactionById.size !== transactions.length) {
    throw new Error("Ledger transaction IDs must be unique.");
  }

  const actions = actionInputs.map(normalizeAction);
  if (
    new Set(actions.map(({ actionId }) => actionId)).size !== actions.length
  ) {
    throw new Error("Reconciliation action IDs must be unique.");
  }
  actions.sort(
    (left, right) =>
      left.recordedAt.localeCompare(right.recordedAt) ||
      left.actionId.localeCompare(right.actionId),
  );

  const state = new Map<string, Omit<ReconciledTransaction, "transaction">>(
    transactions.map(({ transactionId }) => [
      transactionId,
      {
        aggregateStatus: "included",
        exclusionReason: null,
        survivingTransactionId: null,
        reversedByTransactionId: null,
      },
    ]),
  );
  const generatedReversals: NormalizedLedgerEvidence[] = [];

  for (const action of actions) {
    const target = transactionById.get(action.targetTransactionId);
    const targetState = state.get(action.targetTransactionId);
    if (target === undefined || targetState === undefined) {
      throw new Error("Reconciliation target does not exist.");
    }

    if (action.actionType === "restore") {
      if (targetState.reversedByTransactionId !== null) {
        throw new Error("A reversal cannot be restored; add a new correction.");
      }
      if (targetState.aggregateStatus !== "excluded") {
        throw new Error("Only an excluded transaction can be restored.");
      }
      targetState.aggregateStatus = "included";
      targetState.exclusionReason = null;
      targetState.survivingTransactionId = null;
      continue;
    }

    if (targetState.reversedByTransactionId !== null) {
      throw new Error("A reversed transaction cannot receive another action.");
    }
    if (targetState.aggregateStatus === "excluded") {
      throw new Error(
        "An excluded transaction must be restored before another action.",
      );
    }

    if (action.actionType === "exclude") {
      targetState.aggregateStatus = "excluded";
      targetState.exclusionReason = "manual_exclusion";
      continue;
    }

    if (action.actionType === "mark_duplicate") {
      const survivor = transactionById.get(action.survivingTransactionId ?? "");
      if (
        survivor === undefined ||
        survivor.transactionId === target.transactionId
      ) {
        throw new Error(
          "A duplicate survivor must be a different existing transaction.",
        );
      }
      const survivorState = state.get(survivor.transactionId);
      if (
        survivorState === undefined ||
        survivorState.aggregateStatus !== "included" ||
        survivorState.reversedByTransactionId !== null
      ) {
        throw new Error("A duplicate survivor must be active and unreversed.");
      }
      if (duplicateReasons(target, survivor).length === 0) {
        throw new Error(
          "A duplicate action requires matching asset, amount and evidence.",
        );
      }
      targetState.aggregateStatus = "excluded";
      targetState.exclusionReason = "confirmed_duplicate";
      targetState.survivingTransactionId = survivor.transactionId;
      continue;
    }

    const reversalId = action.reversalTransactionId ?? "";
    if (transactionById.has(reversalId)) {
      throw new Error("Reversal transaction ID already exists.");
    }
    const reversal = normalizeLedgerEvidence({
      ...target,
      transactionId: reversalId,
      sourceType: "reversal",
      occurredAt: action.recordedAt,
      signedAmount: negateExactDecimal(target.signedAmount),
      sourceStableKey: `reversal:${target.transactionId}`,
      externalReference: null,
    });
    transactionById.set(reversal.transactionId, reversal);
    generatedReversals.push(reversal);
    targetState.reversedByTransactionId = reversal.transactionId;
  }

  return {
    transactions: transactions.map((transaction) => ({
      transaction,
      ...(state.get(transaction.transactionId) ?? {
        aggregateStatus: "included" as const,
        exclusionReason: null,
        survivingTransactionId: null,
        reversedByTransactionId: null,
      }),
    })),
    generatedReversals,
    auditActions: actions,
  };
}
