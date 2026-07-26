const OPERATIONS = [
  "manual_ledger",
  "tournament_payout",
  "breeding_evidence",
  "offspring_cost_basis",
  "core_sale",
  "core_burn",
  "burn_bgc_credit",
] as const;

const STATUSES = [
  "ready",
  "identity_not_connected",
  "persistence_not_configured",
  "invalid_input",
  "conflict",
  "recorded",
  "replayed",
  "review_required",
  "unexpected_failure",
] as const;

const FIELDS = [
  "core",
  "occurred_at",
  "asset",
  "amount",
  "category",
  "allocation",
  "reference",
  "reason",
  "cost_basis",
  "breeding_event",
  "burn",
] as const;

export type EconomicActionOperation = (typeof OPERATIONS)[number];
export type EconomicActionFeedbackStatus = (typeof STATUSES)[number];
export type EconomicActionField = (typeof FIELDS)[number];

export type EconomicActionFeedbackInput = Readonly<{
  operation: EconomicActionOperation;
  status: EconomicActionFeedbackStatus;
  invalidFields?: readonly EconomicActionField[];
}>;

export type EconomicActionFeedback = Readonly<{
  role: "status" | "alert";
  live: "polite" | "assertive";
  tone: "neutral" | "success" | "warning" | "error";
  title: string;
  detail: string;
  invalidFieldLabels: readonly string[];
  submittedValuesEchoed: false;
  rawErrorEchoed: false;
}>;

const operationLabels: Record<EconomicActionOperation, string> = {
  manual_ledger: "Manual ledger evidence",
  tournament_payout: "Tournament payout evidence",
  breeding_evidence: "Breeding economic evidence",
  offspring_cost_basis: "Offspring cost basis",
  core_sale: "Core sale evidence",
  core_burn: "Core burn evidence",
  burn_bgc_credit: "Actual burn BGC credit",
};

const fieldLabels: Record<EconomicActionField, string> = {
  core: "Core",
  occurred_at: "Occurrence time",
  asset: "Asset",
  amount: "Exact amount",
  category: "Category",
  allocation: "Allocation",
  reference: "External reference",
  reason: "Evidence reason",
  cost_basis: "Cost basis",
  breeding_event: "Breeding event",
  burn: "Confirmed burn",
};

function enumValue<const T extends readonly string[]>(
  value: string,
  values: T,
  label: string,
): T[number] {
  if (!values.includes(value)) throw new Error(`${label} is invalid.`);
  return value as T[number];
}

function invalidFieldLabels(
  status: EconomicActionFeedbackStatus,
  fields: readonly EconomicActionField[] | undefined,
): string[] {
  const values = fields ?? [];
  if (status !== "invalid_input" && values.length > 0) {
    throw new Error("Invalid fields are only allowed for invalid input.");
  }
  const unique = values.map((field) =>
    enumValue(field, FIELDS, "Economic action field"),
  );
  if (new Set(unique).size !== unique.length) {
    throw new Error("Economic action invalid fields must be unique.");
  }
  return unique.map((field) => fieldLabels[field]);
}

export function projectEconomicActionFeedback(
  input: EconomicActionFeedbackInput,
): EconomicActionFeedback {
  const operation = enumValue(
    input.operation,
    OPERATIONS,
    "Economic action operation",
  );
  const status = enumValue(
    input.status,
    STATUSES,
    "Economic action feedback status",
  );
  const label = operationLabels[operation];
  const fields = invalidFieldLabels(status, input.invalidFields);
  const common = {
    invalidFieldLabels: fields,
    submittedValuesEchoed: false as const,
    rawErrorEchoed: false as const,
  };

  switch (status) {
    case "ready":
      return {
        ...common,
        role: "status",
        live: "polite",
        tone: "neutral",
        title: `${label} is ready for review`,
        detail:
          "Review every value before submitting. No wallet or game action is performed.",
      };
    case "identity_not_connected":
      return {
        ...common,
        role: "alert",
        live: "assertive",
        tone: "error",
        title: "Owner verification required",
        detail: `${label} was not recorded because the authenticated owner could not be verified.`,
      };
    case "persistence_not_configured":
      return {
        ...common,
        role: "status",
        live: "polite",
        tone: "warning",
        title: "Evidence recording is unavailable",
        detail: `${label} remains disabled until owner-scoped forced-RLS persistence is connected.`,
      };
    case "invalid_input":
      return {
        ...common,
        role: "alert",
        live: "assertive",
        tone: "error",
        title: "Review the submitted evidence",
        detail:
          fields.length === 0
            ? `${label} was not accepted. Review the required fields and try again.`
            : `${label} was not accepted. Review the listed fields and try again.`,
      };
    case "conflict":
      return {
        ...common,
        role: "alert",
        live: "assertive",
        tone: "error",
        title: "Conflicting durable evidence",
        detail: `${label} was not recorded because its durable identity conflicts with existing evidence.`,
      };
    case "recorded":
      return {
        ...common,
        role: "status",
        live: "polite",
        tone: "success",
        title: "Evidence recorded",
        detail: `${label} was recorded. Review its resulting accounting and completeness state.`,
      };
    case "replayed":
      return {
        ...common,
        role: "status",
        live: "polite",
        tone: "neutral",
        title: "Evidence already recorded",
        detail: `${label} matched the existing durable evidence, so no duplicate record was created.`,
      };
    case "review_required":
      return {
        ...common,
        role: "status",
        live: "polite",
        tone: "warning",
        title: "Evidence needs review",
        detail: `${label} remains outside final accounting until its review items are resolved.`,
      };
    case "unexpected_failure":
      return {
        ...common,
        role: "alert",
        live: "assertive",
        tone: "error",
        title: "Evidence was not recorded",
        detail:
          "The request failed safely. Submitted values and internal error details are not displayed.",
      };
  }
}
