export type ExactAssetAmount = Readonly<{
  asset: string;
  amount: string;
}>;

export type CoreSaleEvidenceInput = Readonly<{
  saleId: string;
  coreId: string;
  occurredAt: string;
  recordedAt: string;
  evidenceSource: "manual" | "authoritative";
  evidenceStatus: "confirmed" | "provisional" | "conflicted";
  ownershipAtSale: "confirmed_active" | "inactive" | "unknown";
  proceeds: ExactAssetAmount;
  sellingFees: readonly ExactAssetAmount[];
  acquisitionCost: ExactAssetAmount | null;
  externalReference: string | null;
  recommendationReferenceId: string | null;
}>;

export type CoreSaleEvidenceResult = Readonly<{
  saleId: string;
  coreId: string;
  status: "postable_review" | "review_required";
  postings: readonly Readonly<{
    postingType: "sale_proceeds" | "selling_fee";
    asset: string;
    signedAmount: string;
  }>[];
  realisedResult: Readonly<{
    status:
      "available" | "missing_cost_basis" | "asset_mismatch" | "unconfirmed";
    asset: string | null;
    signedAmount: string | null;
  }>;
  reviewReasons: readonly string[];
  recommendationWasExecutionEvidence: false;
  saleExecutionAllowed: false;
  ownershipMutationAllowed: false;
  marketValueInferred: false;
}>;

type ParsedDecimal = Readonly<{ units: bigint; scale: number }>;

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

function asset(value: string, label: string): string {
  const normalized = required(value, label).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,15}$/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function decimal(value: string, label: string): ParsedDecimal {
  const normalized = required(value, label);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`${label} must be a positive plain decimal.`);
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  const units = BigInt(`${whole}${fraction}`);
  if (units <= 0n) throw new Error(`${label} must be greater than zero.`);
  return { units, scale: fraction.length };
}

function render(units: bigint, scale: number): string {
  const sign = units < 0n ? "-" : "";
  const digits = (units < 0n ? -units : units)
    .toString()
    .padStart(scale + 1, "0");
  if (scale === 0) return `${sign}${digits}`;
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

function align(values: readonly ParsedDecimal[]): {
  units: bigint[];
  scale: number;
} {
  const scale = Math.max(...values.map((value) => value.scale));
  return {
    scale,
    units: values.map(
      (value) => value.units * 10n ** BigInt(scale - value.scale),
    ),
  };
}

export function assessCoreSaleEvidence(
  input: CoreSaleEvidenceInput,
): CoreSaleEvidenceResult {
  const saleId = required(input.saleId, "Sale ID");
  const coreId = required(input.coreId, "Core ID");
  const occurredAt = timestamp(input.occurredAt, "Sale time");
  const recordedAt = timestamp(input.recordedAt, "Recorded time");
  if (Date.parse(recordedAt) < Date.parse(occurredAt)) {
    throw new Error("Recorded time cannot precede sale time.");
  }
  if (!["manual", "authoritative"].includes(input.evidenceSource)) {
    throw new Error("Sale evidence source is invalid.");
  }
  if (
    !["confirmed", "provisional", "conflicted"].includes(input.evidenceStatus)
  ) {
    throw new Error("Sale evidence status is invalid.");
  }
  if (
    !["confirmed_active", "inactive", "unknown"].includes(input.ownershipAtSale)
  ) {
    throw new Error("Sale ownership evidence is invalid.");
  }
  if (input.externalReference !== null) {
    required(input.externalReference, "External reference");
  }
  if (input.recommendationReferenceId !== null) {
    required(input.recommendationReferenceId, "Recommendation reference");
  }

  const proceedsAsset = asset(input.proceeds.asset, "Proceeds asset");
  const proceeds = decimal(input.proceeds.amount, "Sale proceeds");
  const fees = input.sellingFees.map((fee, index) => ({
    asset: asset(fee.asset, `Selling fee ${index + 1} asset`),
    amount: decimal(fee.amount, `Selling fee ${index + 1}`),
  }));
  const cost =
    input.acquisitionCost === null
      ? null
      : {
          asset: asset(input.acquisitionCost.asset, "Acquisition-cost asset"),
          amount: decimal(input.acquisitionCost.amount, "Acquisition cost"),
        };

  const reviewReasons: string[] = [];
  if (input.evidenceStatus !== "confirmed") {
    reviewReasons.push("Completed sale evidence is not confirmed.");
  }
  if (input.ownershipAtSale !== "confirmed_active") {
    reviewReasons.push("Active ownership at the sale time is not confirmed.");
  }
  const postable = reviewReasons.length === 0;
  const postings = postable
    ? [
        {
          postingType: "sale_proceeds" as const,
          asset: proceedsAsset,
          signedAmount: render(proceeds.units, proceeds.scale),
        },
        ...fees.map((fee) => ({
          postingType: "selling_fee" as const,
          asset: fee.asset,
          signedAmount: render(-fee.amount.units, fee.amount.scale),
        })),
      ]
    : [];

  let realisedResult: CoreSaleEvidenceResult["realisedResult"];
  if (!postable) {
    realisedResult = { status: "unconfirmed", asset: null, signedAmount: null };
  } else if (cost === null) {
    reviewReasons.push("Acquisition cost is unavailable.");
    realisedResult = {
      status: "missing_cost_basis",
      asset: proceedsAsset,
      signedAmount: null,
    };
  } else if (
    cost.asset !== proceedsAsset ||
    fees.some((fee) => fee.asset !== proceedsAsset)
  ) {
    reviewReasons.push("Sale proceeds, cost basis and fees use unlike assets.");
    realisedResult = {
      status: "asset_mismatch",
      asset: null,
      signedAmount: null,
    };
  } else {
    const aligned = align([
      proceeds,
      cost.amount,
      ...fees.map((fee) => fee.amount),
    ]);
    const [proceedsUnits = 0n, costUnits = 0n, ...feeUnits] = aligned.units;
    realisedResult = {
      status: "available",
      asset: proceedsAsset,
      signedAmount: render(
        proceedsUnits -
          costUnits -
          feeUnits.reduce((sum, value) => sum + value, 0n),
        aligned.scale,
      ),
    };
  }

  return {
    saleId,
    coreId,
    status: postable ? "postable_review" : "review_required",
    postings,
    realisedResult,
    reviewReasons,
    recommendationWasExecutionEvidence: false,
    saleExecutionAllowed: false,
    ownershipMutationAllowed: false,
    marketValueInferred: false,
  };
}
