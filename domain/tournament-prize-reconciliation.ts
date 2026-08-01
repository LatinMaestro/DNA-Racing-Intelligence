import { normalizeExactDecimal } from "@/domain/exact-decimal";

export type ManualExternalTournamentPrizeInput = Readonly<{
  payoutId: string;
  occurredAt: string;
  tournamentId: string;
  bracketId?: string | null;
  stage: "qualification" | "round" | "final" | "overall_prize" | "other";
  assetCode: string;
  amount: string;
  externalReference?: string | null;
}>;

export type ImportedTournamentPrizeInput = Readonly<{
  transactionId: string;
  occurredAt: string;
  tournamentId?: string | null;
  bracketId?: string | null;
  stage: "qualification" | "round" | "final" | "unknown";
  assetCode: string;
  amount: string;
  externalReference?: string | null;
  aggregateStatus: "included" | "excluded";
}>;

export type TournamentPrizeReconciliationDecision =
  | Readonly<{
      kind: "confirmed_duplicate";
      importedTransactionId: string;
      decidedAt: string;
      reason: string;
    }>
  | Readonly<{
      kind: "confirmed_separate";
      decidedAt: string;
      reason: string;
    }>;

export type TournamentPrizeDuplicateCandidate = Readonly<{
  importedTransactionId: string;
  strength: "reference_exact" | "amount_date_tournament";
  daysApart: number;
  sameTournament: boolean;
  sameBracket: boolean;
  sameStage: boolean;
}>;

export type TournamentPrizeReconciliationWarning =
  | "EXTERNAL_REFERENCE_CONFLICT"
  | "POTENTIAL_DUPLICATE"
  | "REVIEW_DECISION_REQUIRED"
  | "IMPORTED_PAYOUT_ALREADY_EXCLUDED";

export type TournamentPrizeReconciliation = Readonly<{
  payoutId: string;
  status:
    "clear" | "review_required" | "confirmed_duplicate" | "confirmed_separate";
  manualPayoutAggregateStatus: "included" | "excluded";
  duplicateOfImportedTransactionId: string | null;
  candidates: readonly TournamentPrizeDuplicateCandidate[];
  warnings: readonly TournamentPrizeReconciliationWarning[];
  importedFactsMutable: false;
  automaticExclusionAllowed: false;
  vaultLevelAllocationRequired: false;
}>;

type ManualPrize = Readonly<{
  payoutId: string;
  occurredAt: string;
  tournamentId: string;
  bracketId: string | null;
  stage: ManualExternalTournamentPrizeInput["stage"];
  assetCode: string;
  amount: string;
  externalReference: string | null;
}>;

type ImportedPrize = Readonly<{
  transactionId: string;
  occurredAt: string;
  tournamentId: string | null;
  bracketId: string | null;
  stage: ImportedTournamentPrizeInput["stage"];
  assetCode: string;
  amount: string;
  externalReference: string | null;
  aggregateStatus: ImportedTournamentPrizeInput["aggregateStatus"];
}>;

const millisecondsPerDay = 86_400_000;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function asset(value: string): string {
  const normalized = required(value, "Asset code").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(normalized)) {
    throw new Error("Asset identity is invalid.");
  }
  return normalized;
}

function positiveAmount(value: string): string {
  const normalized = normalizeExactDecimal(value);
  if (normalized === "0" || normalized.startsWith("-")) {
    throw new Error("Tournament prize amount must be positive.");
  }
  return normalized;
}

function normalizeManual(
  input: ManualExternalTournamentPrizeInput,
): ManualPrize {
  if (
    !["qualification", "round", "final", "overall_prize", "other"].includes(
      input.stage,
    )
  ) {
    throw new Error("Manual tournament prize stage is invalid.");
  }
  return {
    payoutId: required(input.payoutId, "Manual payout ID"),
    occurredAt: timestamp(input.occurredAt, "Manual payout timestamp"),
    tournamentId: required(input.tournamentId, "Tournament ID"),
    bracketId: optional(input.bracketId),
    stage: input.stage,
    assetCode: asset(input.assetCode),
    amount: positiveAmount(input.amount),
    externalReference: optional(input.externalReference),
  };
}

function normalizeImported(input: ImportedTournamentPrizeInput): ImportedPrize {
  if (!["qualification", "round", "final", "unknown"].includes(input.stage)) {
    throw new Error("Imported tournament prize stage is invalid.");
  }
  if (!["included", "excluded"].includes(input.aggregateStatus)) {
    throw new Error("Imported aggregate status is invalid.");
  }
  return {
    transactionId: required(input.transactionId, "Imported transaction ID"),
    occurredAt: timestamp(input.occurredAt, "Imported payout timestamp"),
    tournamentId: optional(input.tournamentId),
    bracketId: optional(input.bracketId),
    stage: input.stage,
    assetCode: asset(input.assetCode),
    amount: positiveAmount(input.amount),
    externalReference: optional(input.externalReference),
    aggregateStatus: input.aggregateStatus,
  };
}

function differenceInDays(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / millisecondsPerDay;
}

function isSameStage(manual: ManualPrize, imported: ImportedPrize): boolean {
  return (
    manual.stage !== "overall_prize" &&
    manual.stage !== "other" &&
    imported.stage !== "unknown" &&
    manual.stage === imported.stage
  );
}

export function reconcileManualTournamentPrize(
  manualInput: ManualExternalTournamentPrizeInput,
  importedInputs: readonly ImportedTournamentPrizeInput[],
  decision: TournamentPrizeReconciliationDecision | null = null,
  candidateWindowDays = 3,
): TournamentPrizeReconciliation {
  if (
    !Number.isSafeInteger(candidateWindowDays) ||
    candidateWindowDays < 0 ||
    candidateWindowDays > 31
  ) {
    throw new Error(
      "Duplicate candidate window must be a safe integer from 0 to 31 days.",
    );
  }
  const manual = normalizeManual(manualInput);
  const imported = importedInputs.map(normalizeImported);
  if (
    new Set(imported.map((item) => item.transactionId)).size !== imported.length
  ) {
    throw new Error("Imported tournament transaction IDs must be unique.");
  }

  const warnings = new Set<TournamentPrizeReconciliationWarning>();
  const candidates: TournamentPrizeDuplicateCandidate[] = [];

  for (const item of imported) {
    const daysApart = differenceInDays(manual.occurredAt, item.occurredAt);
    const sameTournament = item.tournamentId === manual.tournamentId;
    const sameBracket =
      item.bracketId !== null && item.bracketId === manual.bracketId;
    const sameStage = isSameStage(manual, item);
    const referenceMatches =
      manual.externalReference !== null &&
      item.externalReference === manual.externalReference;

    if (
      referenceMatches &&
      (!sameTournament ||
        item.assetCode !== manual.assetCode ||
        item.amount !== manual.amount)
    ) {
      warnings.add("EXTERNAL_REFERENCE_CONFLICT");
      continue;
    }
    if (
      referenceMatches &&
      item.assetCode === manual.assetCode &&
      item.amount === manual.amount
    ) {
      candidates.push({
        importedTransactionId: item.transactionId,
        strength: "reference_exact",
        daysApart,
        sameTournament,
        sameBracket,
        sameStage,
      });
      if (item.aggregateStatus === "excluded") {
        warnings.add("IMPORTED_PAYOUT_ALREADY_EXCLUDED");
      }
      continue;
    }
    if (
      item.assetCode === manual.assetCode &&
      item.amount === manual.amount &&
      daysApart <= candidateWindowDays &&
      sameTournament
    ) {
      candidates.push({
        importedTransactionId: item.transactionId,
        strength: "amount_date_tournament",
        daysApart,
        sameTournament,
        sameBracket,
        sameStage,
      });
      if (item.aggregateStatus === "excluded") {
        warnings.add("IMPORTED_PAYOUT_ALREADY_EXCLUDED");
      }
    }
  }

  candidates.sort(
    (left, right) =>
      (left.strength === right.strength
        ? 0
        : left.strength === "reference_exact"
          ? -1
          : 1) ||
      left.daysApart - right.daysApart ||
      left.importedTransactionId.localeCompare(right.importedTransactionId),
  );

  if (candidates.length > 0) {
    warnings.add("POTENTIAL_DUPLICATE");
  }

  if (decision === null) {
    if (candidates.length > 0 || warnings.has("EXTERNAL_REFERENCE_CONFLICT")) {
      warnings.add("REVIEW_DECISION_REQUIRED");
      return {
        payoutId: manual.payoutId,
        status: "review_required",
        manualPayoutAggregateStatus: "included",
        duplicateOfImportedTransactionId: null,
        candidates,
        warnings: [...warnings],
        importedFactsMutable: false,
        automaticExclusionAllowed: false,
        vaultLevelAllocationRequired: false,
      };
    }
    return {
      payoutId: manual.payoutId,
      status: "clear",
      manualPayoutAggregateStatus: "included",
      duplicateOfImportedTransactionId: null,
      candidates: [],
      warnings: [],
      importedFactsMutable: false,
      automaticExclusionAllowed: false,
      vaultLevelAllocationRequired: false,
    };
  }

  timestamp(decision.decidedAt, "Reconciliation decision timestamp");
  if (Date.parse(decision.decidedAt) < Date.parse(manual.occurredAt)) {
    throw new Error(
      "Reconciliation decision cannot predate the manual payout.",
    );
  }
  required(decision.reason, "Reconciliation decision reason");
  if (!["confirmed_duplicate", "confirmed_separate"].includes(decision.kind)) {
    throw new Error("Tournament prize reconciliation decision is invalid.");
  }

  if (decision.kind === "confirmed_separate") {
    return {
      payoutId: manual.payoutId,
      status: "confirmed_separate",
      manualPayoutAggregateStatus: "included",
      duplicateOfImportedTransactionId: null,
      candidates,
      warnings: [...warnings].filter(
        (warning) => warning !== "REVIEW_DECISION_REQUIRED",
      ),
      importedFactsMutable: false,
      automaticExclusionAllowed: false,
      vaultLevelAllocationRequired: false,
    };
  }

  const candidate = candidates.find(
    (item) =>
      item.importedTransactionId === decision.importedTransactionId.trim(),
  );
  if (!candidate) {
    throw new Error(
      "Confirmed duplicate must reference a detected imported candidate.",
    );
  }
  const importedTarget = imported.find(
    (item) => item.transactionId === candidate.importedTransactionId,
  );
  if (!importedTarget || importedTarget.aggregateStatus !== "included") {
    throw new Error(
      "Confirmed duplicate must reference an included imported payout.",
    );
  }

  return {
    payoutId: manual.payoutId,
    status: "confirmed_duplicate",
    manualPayoutAggregateStatus: "excluded",
    duplicateOfImportedTransactionId: candidate.importedTransactionId,
    candidates,
    warnings: [...warnings].filter(
      (warning) => warning !== "REVIEW_DECISION_REQUIRED",
    ),
    importedFactsMutable: false,
    automaticExclusionAllowed: false,
    vaultLevelAllocationRequired: false,
  };
}
