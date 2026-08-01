export type CoreBurnEventInput = Readonly<{
  burnId: string;
  coreId: string;
  coreClass: "Genesis" | "Morphed" | "Freak" | "X-Class";
  occurredAt: string;
  recordedAt: string;
  evidenceSource: "manual" | "authoritative";
  evidenceStatus: "confirmed" | "provisional" | "conflicted";
  ownershipAtBurn: "confirmed_active" | "inactive" | "unknown";
  reason: string;
  recommendationReferenceId: string | null;
}>;

export type CoreBurnEventResult = Readonly<{
  burnId: string;
  coreId: string;
  status: "confirmed_event_review" | "review_required";
  reviewReasons: readonly string[];
  activeVaultProjection: "remove_after_review" | "no_change";
  historicalLineageRetained: true;
  burnCreditAmount: null;
  burnCreditPredicted: false;
  recommendationWasExecutionEvidence: false;
  burnExecutionAllowed: false;
  ownershipMutationAllowed: false;
  ledgerMutationAllowed: false;
}>;

const classes: readonly CoreBurnEventInput["coreClass"][] = [
  "Genesis",
  "Morphed",
  "Freak",
  "X-Class",
];

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

export function assessCoreBurnEvent(
  input: CoreBurnEventInput,
): CoreBurnEventResult {
  const burnId = required(input.burnId, "Burn ID");
  const coreId = required(input.coreId, "Core ID");
  if (!classes.includes(input.coreClass)) {
    throw new Error("Core class is invalid.");
  }
  if (input.coreClass === "Genesis") {
    throw new Error("Genesis cores cannot be burned.");
  }
  const occurredAt = timestamp(input.occurredAt, "Burn time");
  const recordedAt = timestamp(input.recordedAt, "Recorded time");
  if (Date.parse(recordedAt) < Date.parse(occurredAt)) {
    throw new Error("Recorded time cannot precede burn time.");
  }
  if (!["manual", "authoritative"].includes(input.evidenceSource)) {
    throw new Error("Burn evidence source is invalid.");
  }
  if (
    !["confirmed", "provisional", "conflicted"].includes(input.evidenceStatus)
  ) {
    throw new Error("Burn evidence status is invalid.");
  }
  if (
    !["confirmed_active", "inactive", "unknown"].includes(input.ownershipAtBurn)
  ) {
    throw new Error("Burn ownership evidence is invalid.");
  }
  required(input.reason, "Burn evidence reason");
  if (input.recommendationReferenceId !== null) {
    required(input.recommendationReferenceId, "Recommendation reference");
  }

  const reviewReasons: string[] = [];
  if (input.evidenceStatus !== "confirmed") {
    reviewReasons.push("Irreversible burn evidence is not confirmed.");
  }
  if (input.ownershipAtBurn !== "confirmed_active") {
    reviewReasons.push("Active ownership at the burn time is not confirmed.");
  }
  const confirmed = reviewReasons.length === 0;

  return {
    burnId,
    coreId,
    status: confirmed ? "confirmed_event_review" : "review_required",
    reviewReasons,
    activeVaultProjection: confirmed ? "remove_after_review" : "no_change",
    historicalLineageRetained: true,
    burnCreditAmount: null,
    burnCreditPredicted: false,
    recommendationWasExecutionEvidence: false,
    burnExecutionAllowed: false,
    ownershipMutationAllowed: false,
    ledgerMutationAllowed: false,
  };
}
