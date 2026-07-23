export type CostBasisAssetKind = "crypto" | "fiat" | "game_credit";
export type CostBasisSource =
  "authoritative_transaction_export" | "manual_confirmed";
export type PairingCostCategory =
  "dna_base_fee" | "external_arena_fee" | "arena_fee_bgc";

export type PairingCostInput = Readonly<{
  transactionId: string;
  category: PairingCostCategory;
  source: CostBasisSource;
  evidenceStatus: "confirmed" | "proposed" | "reversed";
  assetCode: string;
  assetKind: CostBasisAssetKind;
  amount: string;
}>;

export type PairingRefundInput = Readonly<{
  transactionId: string;
  appliesToTransactionId: string;
  source: CostBasisSource;
  evidenceStatus: "confirmed" | "proposed" | "reversed";
  assetCode: string;
  assetKind: CostBasisAssetKind;
  amount: string;
}>;

export type OffspringCostBasisInput = Readonly<{
  assignmentId: string;
  offspringCoreId: string;
  breedingEventId: string;
  breedingOccurredAt: string;
  requestedAt: string;
  ownershipStatus: "confirmed_owned" | "not_owned" | "unknown";
  breedingEventStatus: "completed" | "refunded" | "failed" | "unknown";
  costs: readonly PairingCostInput[];
  refunds: readonly PairingRefundInput[];
  previouslyAssignedTransactionIds: readonly string[];
}>;

export type OffspringCostBasisResult = Readonly<{
  assignmentId: string;
  offspringCoreId: string;
  breedingEventId: string;
  breedingOccurredAt: string;
  requestedAt: string;
  status:
    | "assignment_review"
    | "held_for_ownership"
    | "held_for_event"
    | "held_for_duplicate"
    | "held_for_evidence";
  components: readonly Readonly<{
    transactionId: string;
    category: PairingCostCategory | "refund";
    appliesToTransactionId: string | null;
    assetCode: string;
    assetKind: CostBasisAssetKind;
    signedAmount: string;
  }>[];
  totalsByAsset: readonly Readonly<{
    assetCode: string;
    assetKind: CostBasisAssetKind;
    grossCostAmount: string;
    refundAmount: string;
    netCostBasisAmount: string;
  }>[];
  holdReasons: readonly string[];
  originalAssetsCombined: false;
  marketValueAssigned: false;
  realisedGainCalculated: false;
  assignmentMutationAllowed: false;
}>;

const costCategories: readonly PairingCostCategory[] = [
  "dna_base_fee",
  "external_arena_fee",
  "arena_fee_bgc",
];
const sources: readonly CostBasisSource[] = [
  "authoritative_transaction_export",
  "manual_confirmed",
];
const assetKinds: readonly CostBasisAssetKind[] = [
  "crypto",
  "fiat",
  "game_credit",
];
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;

type ParsedDecimal = {
  digits: bigint;
  scale: number;
};

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

function parseDecimal(value: string, label: string): ParsedDecimal {
  const normalized = value.trim();
  if (!decimalPattern.test(normalized)) {
    throw new Error(`${label} must be a positive plain base-10 decimal.`);
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  if (digits === 0n) throw new Error(`${label} must be greater than zero.`);
  return { digits, scale: fraction.length };
}

function align(value: ParsedDecimal, scale: number): bigint {
  return value.digits * 10n ** BigInt(scale - value.scale);
}

function add(left: ParsedDecimal, right: ParsedDecimal): ParsedDecimal {
  const scale = Math.max(left.scale, right.scale);
  return { digits: align(left, scale) + align(right, scale), scale };
}

function subtract(left: ParsedDecimal, right: ParsedDecimal): ParsedDecimal {
  const scale = Math.max(left.scale, right.scale);
  return { digits: align(left, scale) - align(right, scale), scale };
}

function compare(left: ParsedDecimal, right: ParsedDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const difference = align(left, scale) - align(right, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function format(value: ParsedDecimal): string {
  if (value.digits === 0n) return "0";
  const negative = value.digits < 0n;
  const absolute = (negative ? -value.digits : value.digits)
    .toString()
    .padStart(value.scale + 1, "0");
  const whole =
    value.scale === 0
      ? absolute
      : absolute.slice(0, Math.max(1, absolute.length - value.scale));
  const fraction =
    value.scale === 0
      ? ""
      : absolute.slice(absolute.length - value.scale).replace(/0+$/, "");
  const unsigned = fraction === "" ? whole : `${whole}.${fraction}`;
  return negative ? `-${unsigned}` : unsigned;
}

function validateAsset(
  assetCodeInput: string,
  assetKind: CostBasisAssetKind,
  category: PairingCostCategory | "refund",
): string {
  if (!assetKinds.includes(assetKind)) {
    throw new Error("Cost-basis asset kind is invalid.");
  }
  const assetCode = required(assetCodeInput, "Asset code").toUpperCase();
  if (!assetCodePattern.test(assetCode)) {
    throw new Error("Cost-basis asset code is invalid.");
  }
  if (
    (assetCode === "BGC" && assetKind !== "game_credit") ||
    (assetCode !== "BGC" && assetKind === "game_credit") ||
    (category === "arena_fee_bgc" && assetCode !== "BGC")
  ) {
    throw new Error("BGC must remain the separate game-credit asset.");
  }
  return assetCode;
}

export function buildOffspringCostBasis(
  input: OffspringCostBasisInput,
): OffspringCostBasisResult {
  const assignmentId = required(input.assignmentId, "Assignment ID");
  const offspringCoreId = required(input.offspringCoreId, "Offspring core ID");
  const breedingEventId = required(input.breedingEventId, "Breeding event ID");
  const breedingOccurredAt = timestamp(
    input.breedingOccurredAt,
    "Breeding occurrence time",
  );
  const requestedAt = timestamp(input.requestedAt, "Assignment request time");
  if (Date.parse(requestedAt) < Date.parse(breedingOccurredAt)) {
    throw new Error("Cost-basis assignment cannot predate breeding.");
  }
  if (
    !["confirmed_owned", "not_owned", "unknown"].includes(input.ownershipStatus)
  ) {
    throw new Error("Offspring ownership status is invalid.");
  }
  if (
    !["completed", "refunded", "failed", "unknown"].includes(
      input.breedingEventStatus,
    )
  ) {
    throw new Error("Breeding event status is invalid.");
  }

  const previouslyAssigned = new Set(
    input.previouslyAssignedTransactionIds.map((transactionId) =>
      required(transactionId, "Previously assigned transaction ID"),
    ),
  );
  const transactionIds = new Set<string>();
  const costsById = new Map<
    string,
    {
      assetCode: string;
      assetKind: CostBasisAssetKind;
      amount: ParsedDecimal;
    }
  >();
  const components: {
    transactionId: string;
    category: PairingCostCategory | "refund";
    appliesToTransactionId: string | null;
    assetCode: string;
    assetKind: CostBasisAssetKind;
    signedAmount: string;
  }[] = [];
  let hasUnconfirmedEvidence = false;
  let hasPreviouslyAssignedTransaction = false;

  for (const cost of input.costs) {
    const transactionId = required(cost.transactionId, "Cost transaction ID");
    if (transactionIds.has(transactionId)) {
      throw new Error("Cost-basis transaction IDs must be unique.");
    }
    transactionIds.add(transactionId);
    if (!costCategories.includes(cost.category)) {
      throw new Error("Pairing cost category is invalid.");
    }
    if (!sources.includes(cost.source)) {
      throw new Error("Pairing cost source is invalid.");
    }
    if (!["confirmed", "proposed", "reversed"].includes(cost.evidenceStatus)) {
      throw new Error("Pairing cost evidence status is invalid.");
    }
    if (cost.evidenceStatus !== "confirmed") hasUnconfirmedEvidence = true;
    if (previouslyAssigned.has(transactionId)) {
      hasPreviouslyAssignedTransaction = true;
    }
    const assetCode = validateAsset(
      cost.assetCode,
      cost.assetKind,
      cost.category,
    );
    const amount = parseDecimal(cost.amount, "Pairing cost");
    costsById.set(transactionId, {
      assetCode,
      assetKind: cost.assetKind,
      amount,
    });
    components.push({
      transactionId,
      category: cost.category,
      appliesToTransactionId: null,
      assetCode,
      assetKind: cost.assetKind,
      signedAmount: format(amount),
    });
  }

  const refundsByCost = new Map<string, ParsedDecimal>();
  for (const refund of input.refunds) {
    const transactionId = required(
      refund.transactionId,
      "Refund transaction ID",
    );
    if (transactionIds.has(transactionId)) {
      throw new Error("Cost-basis transaction IDs must be unique.");
    }
    transactionIds.add(transactionId);
    const appliesToTransactionId = required(
      refund.appliesToTransactionId,
      "Refund cost reference",
    );
    const cost = costsById.get(appliesToTransactionId);
    if (cost === undefined) {
      throw new Error("Every refund must reference an included pairing cost.");
    }
    if (!sources.includes(refund.source)) {
      throw new Error("Pairing refund source is invalid.");
    }
    if (
      !["confirmed", "proposed", "reversed"].includes(refund.evidenceStatus)
    ) {
      throw new Error("Pairing refund evidence status is invalid.");
    }
    if (refund.evidenceStatus !== "confirmed") hasUnconfirmedEvidence = true;
    if (previouslyAssigned.has(transactionId)) {
      hasPreviouslyAssignedTransaction = true;
    }
    const assetCode = validateAsset(
      refund.assetCode,
      refund.assetKind,
      "refund",
    );
    if (assetCode !== cost.assetCode || refund.assetKind !== cost.assetKind) {
      throw new Error("A refund must use the same asset as its pairing cost.");
    }
    const amount = parseDecimal(refund.amount, "Pairing refund");
    const cumulativeRefund = add(
      refundsByCost.get(appliesToTransactionId) ?? { digits: 0n, scale: 0 },
      amount,
    );
    if (compare(cumulativeRefund, cost.amount) > 0) {
      throw new Error("A refund cannot exceed its referenced pairing cost.");
    }
    refundsByCost.set(appliesToTransactionId, cumulativeRefund);
    components.push({
      transactionId,
      category: "refund",
      appliesToTransactionId,
      assetCode,
      assetKind: refund.assetKind,
      signedAmount: `-${format(amount)}`,
    });
  }

  const totals = new Map<
    string,
    {
      assetCode: string;
      assetKind: CostBasisAssetKind;
      gross: ParsedDecimal;
      refunds: ParsedDecimal;
    }
  >();
  for (const component of components) {
    const key = `${component.assetKind}\u0000${component.assetCode}`;
    const total = totals.get(key) ?? {
      assetCode: component.assetCode,
      assetKind: component.assetKind,
      gross: { digits: 0n, scale: 0 },
      refunds: { digits: 0n, scale: 0 },
    };
    const amount = parseDecimal(
      component.signedAmount.startsWith("-")
        ? component.signedAmount.slice(1)
        : component.signedAmount,
      "Cost-basis component",
    );
    if (component.category === "refund")
      total.refunds = add(total.refunds, amount);
    else total.gross = add(total.gross, amount);
    totals.set(key, total);
  }

  const totalsByAsset = [...totals.values()]
    .sort((left, right) => left.assetCode.localeCompare(right.assetCode))
    .map((total) => ({
      assetCode: total.assetCode,
      assetKind: total.assetKind,
      grossCostAmount: format(total.gross),
      refundAmount: format(total.refunds),
      netCostBasisAmount: format(subtract(total.gross, total.refunds)),
    }));

  const holdReasons: string[] = [];
  if (input.ownershipStatus !== "confirmed_owned") {
    holdReasons.push("Offspring ownership is not confirmed.");
  }
  if (input.breedingEventStatus !== "completed") {
    holdReasons.push("Breeding event is not confirmed complete.");
  }
  if (hasPreviouslyAssignedTransaction) {
    holdReasons.push(
      "A transaction is already assigned to another cost basis.",
    );
  }
  if (hasUnconfirmedEvidence || input.costs.length === 0) {
    holdReasons.push(
      "All assigned pairing costs must be confirmed actual costs.",
    );
  }

  let status: OffspringCostBasisResult["status"] = "assignment_review";
  if (input.ownershipStatus !== "confirmed_owned") {
    status = "held_for_ownership";
  } else if (input.breedingEventStatus !== "completed") {
    status = "held_for_event";
  } else if (hasPreviouslyAssignedTransaction) {
    status = "held_for_duplicate";
  } else if (hasUnconfirmedEvidence || input.costs.length === 0) {
    status = "held_for_evidence";
  }

  return {
    assignmentId,
    offspringCoreId,
    breedingEventId,
    breedingOccurredAt,
    requestedAt,
    status,
    components,
    totalsByAsset,
    holdReasons,
    originalAssetsCombined: false,
    marketValueAssigned: false,
    realisedGainCalculated: false,
    assignmentMutationAllowed: false,
  };
}
