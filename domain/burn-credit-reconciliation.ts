export type ConfirmedBurnEvidence = Readonly<{
  burnId: string;
  coreId: string;
  occurredAt: string;
  status: "confirmed_event_review" | "review_required";
}>;

export type BurnCreditEvidence = Readonly<{
  creditId: string;
  coreId: string;
  burnId: string | null;
  occurredAt: string;
  asset: string;
  amount: string;
  evidenceSource: "manual" | "authoritative";
  evidenceStatus: "confirmed" | "provisional" | "conflicted";
  externalReference: string | null;
}>;

export type BurnCreditReconciliationResult = Readonly<{
  burnId: string;
  coreId: string;
  status:
    | "matched_actual_credit"
    | "credit_missing"
    | "review_required"
    | "burn_unconfirmed";
  matchedCreditId: string | null;
  actualBgcAmount: string | null;
  reviewItems: readonly Readonly<{
    creditId: string;
    reason: string;
  }>[];
  ledgerPostingProposed: boolean;
  automaticExclusionAllowed: false;
  creditPredicted: false;
  strategicRecommendationUsed: false;
  burnEventMutated: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function amount(value: string): string {
  const normalized = required(value, "BGC amount");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error("BGC amount must be a positive plain decimal.");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (BigInt(`${whole}${fraction}`) <= 0n) {
    throw new Error("BGC amount must be greater than zero.");
  }
  return normalized;
}

export function reconcileBurnCredit(input: {
  burn: ConfirmedBurnEvidence;
  credits: readonly BurnCreditEvidence[];
}): BurnCreditReconciliationResult {
  const burnId = required(input.burn.burnId, "Burn ID");
  const coreId = required(input.burn.coreId, "Core ID");
  const burnTime = timestamp(input.burn.occurredAt, "Burn time");
  if (
    !["confirmed_event_review", "review_required"].includes(input.burn.status)
  ) {
    throw new Error("Burn status is invalid.");
  }

  const creditIds = input.credits.map(({ creditId }) =>
    required(creditId, "Credit ID"),
  );
  if (new Set(creditIds).size !== creditIds.length) {
    throw new Error("Credit IDs must be unique.");
  }

  const directMatches: { creditId: string; amount: string }[] = [];
  const reviewItems: { creditId: string; reason: string }[] = [];
  for (const credit of input.credits) {
    const creditId = required(credit.creditId, "Credit ID");
    const creditCoreId = required(credit.coreId, "Credit core ID");
    const creditTime = timestamp(credit.occurredAt, "Credit time");
    if (credit.burnId !== null) required(credit.burnId, "Credit burn ID");
    if (credit.asset.trim().toUpperCase() !== "BGC") {
      throw new Error(`Burn credit ${creditId} must use BGC.`);
    }
    const exactAmount = amount(credit.amount);
    if (!["manual", "authoritative"].includes(credit.evidenceSource)) {
      throw new Error(`Burn credit source is invalid for ${creditId}.`);
    }
    if (
      !["confirmed", "provisional", "conflicted"].includes(
        credit.evidenceStatus,
      )
    ) {
      throw new Error(`Burn credit status is invalid for ${creditId}.`);
    }
    if (credit.externalReference !== null) {
      required(credit.externalReference, "External reference");
    }

    if (Date.parse(creditTime) < Date.parse(burnTime)) {
      reviewItems.push({ creditId, reason: "Credit predates the burn event." });
      continue;
    }
    if (creditCoreId !== coreId) {
      reviewItems.push({ creditId, reason: "Credit references another core." });
      continue;
    }
    if (credit.burnId !== null && credit.burnId !== burnId) {
      reviewItems.push({ creditId, reason: "Credit references another burn." });
      continue;
    }
    if (credit.evidenceStatus !== "confirmed") {
      reviewItems.push({
        creditId,
        reason: "Credit evidence is not confirmed.",
      });
      continue;
    }
    if (credit.burnId === null) {
      reviewItems.push({
        creditId,
        reason: "Core/date match requires confirmation of the burn link.",
      });
      continue;
    }
    directMatches.push({ creditId, amount: exactAmount });
  }

  if (input.burn.status !== "confirmed_event_review") {
    return {
      burnId,
      coreId,
      status: "burn_unconfirmed",
      matchedCreditId: null,
      actualBgcAmount: null,
      reviewItems,
      ledgerPostingProposed: false,
      automaticExclusionAllowed: false,
      creditPredicted: false,
      strategicRecommendationUsed: false,
      burnEventMutated: false,
    };
  }

  if (directMatches.length > 1) {
    reviewItems.push(
      ...directMatches.map(({ creditId }) => ({
        creditId,
        reason: "Multiple confirmed credits reference the same burn.",
      })),
    );
  }
  const matched = directMatches.length === 1 ? directMatches[0]! : null;
  const status =
    directMatches.length > 1 || reviewItems.length > 0
      ? "review_required"
      : matched
        ? "matched_actual_credit"
        : "credit_missing";

  return {
    burnId,
    coreId,
    status,
    matchedCreditId:
      status === "matched_actual_credit" ? (matched?.creditId ?? null) : null,
    actualBgcAmount:
      status === "matched_actual_credit" ? (matched?.amount ?? null) : null,
    reviewItems,
    ledgerPostingProposed: status === "matched_actual_credit",
    automaticExclusionAllowed: false,
    creditPredicted: false,
    strategicRecommendationUsed: false,
    burnEventMutated: false,
  };
}
