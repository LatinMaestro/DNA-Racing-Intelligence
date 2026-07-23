export type BreedingEconomicSource =
  "authoritative_transaction_export" | "manual_confirmed" | "arena_listing";
export type BreedingEconomicLifecycle =
  "completed" | "refunded" | "failed" | "pending" | "unknown";
export type BreedingEconomicAssetKind = "crypto" | "fiat" | "game_credit";
export type BreedingEconomicCategory =
  | "dna_base_fee"
  | "external_arena_fee"
  | "arena_fee_bgc"
  | "breeding_fee_earned"
  | "refund";

export type BreedingEconomicEntryInput = Readonly<{
  transactionId: string;
  category: BreedingEconomicCategory;
  direction: "credit" | "debit";
  assetCode: string;
  assetKind: BreedingEconomicAssetKind;
  amount: string;
  externalReference: string | null;
}>;

export type BreedingEconomicEvidenceInput = Readonly<{
  evidenceId: string;
  breedingEventId: string;
  source: BreedingEconomicSource;
  lifecycle: BreedingEconomicLifecycle;
  occurredAt: string | null;
  parentCoreIds: readonly [string, string];
  offspringCoreId: string | null;
  evidenceNote: string | null;
  entries: readonly BreedingEconomicEntryInput[];
}>;

type BreedingEconomicPosting = Readonly<{
  postingId: string;
  transactionId: string;
  breedingEventId: string;
  category: BreedingEconomicCategory;
  direction: "credit" | "debit";
  assetCode: string;
  assetKind: BreedingEconomicAssetKind;
  amount: string;
  signedAmount: string;
  parentCoreIds: readonly [string, string];
  offspringCoreId: string | null;
  externalReference: string | null;
}>;

export type BreedingEconomicEvidenceResult = Readonly<{
  evidenceId: string;
  breedingEventId: string;
  source: BreedingEconomicSource;
  lifecycle: BreedingEconomicLifecycle;
  occurredAt: string | null;
  status:
    | "postable_review"
    | "refunded_review"
    | "non_transaction_evidence"
    | "held_for_completion"
    | "held_for_evidence";
  postings: readonly BreedingEconomicPosting[];
  totalsByAsset: readonly Readonly<{
    assetCode: string;
    assetKind: BreedingEconomicAssetKind;
    creditAmount: string;
    debitAmount: string;
    netAmount: string;
  }>[];
  holdReasons: readonly string[];
  arenaListingTreatedAsIncome: false;
  assetsCombined: false;
  ledgerMutationAllowed: false;
  walletOrGameTransactionAllowed: false;
}>;

const sources: readonly BreedingEconomicSource[] = [
  "authoritative_transaction_export",
  "manual_confirmed",
  "arena_listing",
];
const lifecycles: readonly BreedingEconomicLifecycle[] = [
  "completed",
  "refunded",
  "failed",
  "pending",
  "unknown",
];
const categories: readonly BreedingEconomicCategory[] = [
  "dna_base_fee",
  "external_arena_fee",
  "arena_fee_bgc",
  "breeding_fee_earned",
  "refund",
];
const assetKinds: readonly BreedingEconomicAssetKind[] = [
  "crypto",
  "fiat",
  "game_credit",
];
const debitCategories = new Set<BreedingEconomicCategory>([
  "dna_base_fee",
  "external_arena_fee",
  "arena_fee_bgc",
]);
const creditCategories = new Set<BreedingEconomicCategory>([
  "breeding_fee_earned",
  "refund",
]);
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;

type ParsedDecimal = Readonly<{
  digits: bigint;
  scale: number;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
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

function formatDecimal(digits: bigint, scale: number): string {
  if (digits === 0n) return "0";
  const negative = digits < 0n;
  const absolute = (negative ? -digits : digits)
    .toString()
    .padStart(scale + 1, "0");
  const whole =
    scale === 0
      ? absolute
      : absolute.slice(0, Math.max(1, absolute.length - scale));
  const fraction =
    scale === 0
      ? ""
      : absolute.slice(absolute.length - scale).replace(/0+$/, "");
  const unsigned = fraction === "" ? whole : `${whole}.${fraction}`;
  return negative ? `-${unsigned}` : unsigned;
}

function normalizeDecimal(parsed: ParsedDecimal): string {
  return formatDecimal(parsed.digits, parsed.scale);
}

function addDecimal(
  left: { digits: bigint; scale: number },
  right: { digits: bigint; scale: number },
): { digits: bigint; scale: number } {
  const scale = Math.max(left.scale, right.scale);
  return {
    digits:
      left.digits * 10n ** BigInt(scale - left.scale) +
      right.digits * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

export function classifyBreedingEconomicEvidence(
  input: BreedingEconomicEvidenceInput,
): BreedingEconomicEvidenceResult {
  const evidenceId = required(input.evidenceId, "Evidence ID");
  const breedingEventId = required(input.breedingEventId, "Breeding event ID");
  if (!sources.includes(input.source)) {
    throw new Error("Breeding economic source is invalid.");
  }
  if (!lifecycles.includes(input.lifecycle)) {
    throw new Error("Breeding lifecycle is invalid.");
  }
  const parentCoreIds = input.parentCoreIds.map((coreId) =>
    required(coreId, "Parent core ID"),
  ) as [string, string];
  if (parentCoreIds[0] === parentCoreIds[1]) {
    throw new Error("Breeding evidence requires two distinct parents.");
  }
  const offspringCoreId = optional(input.offspringCoreId);
  const evidenceNote = optional(input.evidenceNote);
  const occurredAt = timestamp(input.occurredAt, "Occurrence time");

  if (input.source === "arena_listing") {
    if (input.entries.length > 0 || occurredAt !== null) {
      throw new Error(
        "Arena listings cannot carry completed economic transactions.",
      );
    }
    return {
      evidenceId,
      breedingEventId,
      source: input.source,
      lifecycle: input.lifecycle,
      occurredAt,
      status: "non_transaction_evidence",
      postings: [],
      totalsByAsset: [],
      holdReasons: [
        "Arena availability and nominated fees do not prove completed breeding.",
      ],
      arenaListingTreatedAsIncome: false,
      assetsCombined: false,
      ledgerMutationAllowed: false,
      walletOrGameTransactionAllowed: false,
    };
  }

  if (input.source === "manual_confirmed" && evidenceNote === null) {
    throw new Error("Manual breeding evidence requires an audit note.");
  }
  if (occurredAt === null) {
    throw new Error("Confirmed breeding evidence requires an occurrence time.");
  }
  if (
    ["failed", "pending", "unknown"].includes(input.lifecycle) &&
    input.entries.length > 0
  ) {
    throw new Error(
      "Uncompleted breeding evidence cannot create economic postings.",
    );
  }
  if (
    input.lifecycle === "refunded" &&
    input.entries.some(({ category }) => category !== "refund")
  ) {
    throw new Error("Refunded evidence may contain only confirmed refunds.");
  }

  const transactionIds = new Set<string>();
  const assetTotals = new Map<
    string,
    {
      assetCode: string;
      assetKind: BreedingEconomicAssetKind;
      credit: { digits: bigint; scale: number };
      debit: { digits: bigint; scale: number };
    }
  >();
  const postings = input.entries.map((entry) => {
    const transactionId = required(entry.transactionId, "Transaction ID");
    if (transactionIds.has(transactionId)) {
      throw new Error("Breeding transaction IDs must be unique.");
    }
    transactionIds.add(transactionId);
    if (!categories.includes(entry.category)) {
      throw new Error("Breeding economic category is invalid.");
    }
    if (!["credit", "debit"].includes(entry.direction)) {
      throw new Error("Breeding transaction direction is invalid.");
    }
    if (
      (debitCategories.has(entry.category) && entry.direction !== "debit") ||
      (creditCategories.has(entry.category) && entry.direction !== "credit")
    ) {
      throw new Error("Breeding category and direction are inconsistent.");
    }
    if (!assetKinds.includes(entry.assetKind)) {
      throw new Error("Breeding asset kind is invalid.");
    }
    const assetCode = required(entry.assetCode, "Asset code").toUpperCase();
    if (!assetCodePattern.test(assetCode)) {
      throw new Error("Breeding asset code is invalid.");
    }
    if (
      (assetCode === "BGC" && entry.assetKind !== "game_credit") ||
      (assetCode !== "BGC" && entry.assetKind === "game_credit") ||
      (entry.category === "arena_fee_bgc" && assetCode !== "BGC")
    ) {
      throw new Error("BGC must remain the separate game-credit asset.");
    }
    const parsedAmount = parseDecimal(entry.amount, "Breeding amount");
    const amount = normalizeDecimal(parsedAmount);
    const assetKey = `${entry.assetKind}\u0000${assetCode}`;
    const total = assetTotals.get(assetKey) ?? {
      assetCode,
      assetKind: entry.assetKind,
      credit: { digits: 0n, scale: 0 },
      debit: { digits: 0n, scale: 0 },
    };
    if (entry.direction === "credit") {
      total.credit = addDecimal(total.credit, parsedAmount);
    } else {
      total.debit = addDecimal(total.debit, parsedAmount);
    }
    assetTotals.set(assetKey, total);
    return {
      postingId: `${breedingEventId}:${transactionId}`,
      transactionId,
      breedingEventId,
      category: entry.category,
      direction: entry.direction,
      assetCode,
      assetKind: entry.assetKind,
      amount,
      signedAmount: entry.direction === "debit" ? `-${amount}` : amount,
      parentCoreIds,
      offspringCoreId,
      externalReference: optional(entry.externalReference),
    };
  });

  const totalsByAsset = [...assetTotals.values()]
    .sort((left, right) => left.assetCode.localeCompare(right.assetCode))
    .map((total) => {
      const net = addDecimal(total.credit, {
        digits: -total.debit.digits,
        scale: total.debit.scale,
      });
      return {
        assetCode: total.assetCode,
        assetKind: total.assetKind,
        creditAmount: formatDecimal(total.credit.digits, total.credit.scale),
        debitAmount: formatDecimal(total.debit.digits, total.debit.scale),
        netAmount: formatDecimal(net.digits, net.scale),
      };
    });

  const completed = input.lifecycle === "completed";
  const missingEconomicEvidence =
    (completed || input.lifecycle === "refunded") && postings.length === 0;
  return {
    evidenceId,
    breedingEventId,
    source: input.source,
    lifecycle: input.lifecycle,
    occurredAt,
    status: missingEconomicEvidence
      ? "held_for_evidence"
      : completed
        ? "postable_review"
        : input.lifecycle === "refunded"
          ? "refunded_review"
          : "held_for_completion",
    postings,
    totalsByAsset,
    holdReasons: missingEconomicEvidence
      ? ["Completed economic evidence contains no confirmed transactions."]
      : completed
        ? []
        : input.lifecycle === "refunded"
          ? []
          : ["Breeding is not confirmed complete."],
    arenaListingTreatedAsIncome: false,
    assetsCombined: false,
    ledgerMutationAllowed: false,
    walletOrGameTransactionAllowed: false,
  };
}
