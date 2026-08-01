import { normalizeExactDecimal } from "@/domain/exact-decimal";

export const manualTournamentPayoutAllocationMethods = [
  "vault_unallocated",
  "single_core",
  "equal",
  "manual_amounts",
  "manual_percentages",
  "documented_points",
] as const;
export type ManualTournamentPayoutAllocationMethod =
  (typeof manualTournamentPayoutAllocationMethods)[number];

export type ManualTournamentPayoutAllocationInput = {
  coreId: string;
  amount?: string;
  percentage?: string;
  points?: string;
};

export type ManualTournamentPayoutInput = {
  payoutId: string;
  occurredAt: string;
  tournamentId: string;
  season?: string | null;
  bracketId?: string | null;
  leaderboardId?: string | null;
  stage: "qualification" | "round" | "final" | "overall_prize" | "other";
  amount: string;
  assetCode: string;
  assetKind: "crypto" | "fiat";
  assetDecimalPlaces: number;
  receivingAccountLabel?: string | null;
  externalReference?: string | null;
  evidenceNote?: string | null;
  allocationMethod: ManualTournamentPayoutAllocationMethod;
  allocations?: readonly ManualTournamentPayoutAllocationInput[];
};

export type TournamentPayoutAssetDefinition = Readonly<{
  code: string;
  kind: "crypto" | "fiat" | "game_credit";
  precision: number;
}>;

export type TournamentPayoutCampaignBinding = Readonly<{
  tournamentId: string;
  evidenceId: string;
  configurationVersion: string;
  ownerAcknowledgedAt: string;
}>;

export type ManualTournamentPayoutAllocation = {
  coreId: string;
  amount: string;
  percentage: string | null;
  points: string | null;
};

export type ManualTournamentPayout = {
  payoutId: string;
  occurredAt: string;
  tournamentId: string;
  season: string | null;
  bracketId: string | null;
  leaderboardId: string | null;
  stage: ManualTournamentPayoutInput["stage"];
  amount: string;
  assetCode: string;
  assetKind: ManualTournamentPayoutInput["assetKind"];
  assetDecimalPlaces: number;
  assetRegistryVersion: string;
  tournamentCampaignBinding: TournamentPayoutCampaignBinding;
  tournamentAggregationEligible: true;
  receivingAccountLabel: string | null;
  externalReference: string | null;
  evidenceNote: string | null;
  sourceType: "manual_tournament_payout";
  allocationMethod: ManualTournamentPayoutAllocationMethod;
  allocationStatus: "vault_unallocated" | "explicit_core_allocations";
  allocations: readonly ManualTournamentPayoutAllocation[];
  allocatedAmount: string;
  unallocatedAmount: string;
  duplicateReviewRequired: true;
  operatingIncome: true;
};

type ParsedDecimal = {
  negative: boolean;
  digits: bigint;
  scale: number;
};

type WeightedAllocation = {
  coreId: string;
  weight: bigint;
  percentage: string | null;
  points: string | null;
};

const stageValues = [
  "qualification",
  "round",
  "final",
  "overall_prize",
  "other",
] as const;
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;
const unsignedIntegerPattern = /^(?:0|[1-9]\d*)$/;

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function normalizeTimestamp(value: string): string {
  const trimmed = requiredTrimmed(value, "Payout timestamp");
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) throw new Error("Payout timestamp must be valid.");
  return new Date(parsed).toISOString();
}

function normalizeContextTimestamp(value: string, label: string): string {
  const trimmed = requiredTrimmed(value, label);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function parseDecimal(value: string): ParsedDecimal {
  const normalized = normalizeExactDecimal(value);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    negative,
    digits: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function toAtoms(value: string, decimalPlaces: number): bigint {
  const parsed = parseDecimal(value);
  if (parsed.negative || parsed.digits === 0n) {
    throw new Error("Payout and allocation amounts must be positive.");
  }
  if (parsed.scale > decimalPlaces) {
    throw new Error("Amount exceeds the configured asset precision.");
  }
  return parsed.digits * 10n ** BigInt(decimalPlaces - parsed.scale);
}

function formatAtoms(value: bigint, decimalPlaces: number): string {
  if (value < 0n) throw new Error("Allocation atoms cannot be negative.");
  if (value === 0n) return "0";
  const raw = value.toString().padStart(decimalPlaces + 1, "0");
  if (decimalPlaces === 0) return raw;
  const whole = raw.slice(0, raw.length - decimalPlaces);
  const fraction = raw.slice(raw.length - decimalPlaces).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function normalizeCoreIds(
  allocations: readonly ManualTournamentPayoutAllocationInput[],
): string[] {
  const coreIds = allocations.map((allocation) =>
    requiredTrimmed(allocation.coreId, "Core ID"),
  );
  if (new Set(coreIds).size !== coreIds.length) {
    throw new Error("Payout allocation core IDs must be unique.");
  }
  return coreIds;
}

function commonScale(values: readonly string[]): number {
  return Math.max(0, ...values.map((value) => parseDecimal(value).scale));
}

function exactWeight(value: string, scale: number, label: string): bigint {
  const normalized = normalizeExactDecimal(value);
  const parsed = parseDecimal(normalized);
  if (parsed.negative || parsed.digits === 0n) {
    throw new Error(`${label} must be positive.`);
  }
  return parsed.digits * 10n ** BigInt(scale - parsed.scale);
}

function apportion(
  totalAtoms: bigint,
  weighted: readonly WeightedAllocation[],
): ManualTournamentPayoutAllocation[] {
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0n);
  if (totalWeight <= 0n) throw new Error("Allocation weight is required.");

  const provisional = weighted.map((item) => {
    const numerator = totalAtoms * item.weight;
    return {
      ...item,
      atoms: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });
  let remaining =
    totalAtoms -
    provisional.reduce((sum, allocation) => sum + allocation.atoms, 0n);
  const remainderOrder = [...provisional].sort(
    (left, right) =>
      (left.remainder === right.remainder
        ? 0
        : left.remainder > right.remainder
          ? -1
          : 1) || left.coreId.localeCompare(right.coreId),
  );
  for (const allocation of remainderOrder) {
    if (remaining === 0n) break;
    allocation.atoms += 1n;
    remaining -= 1n;
  }
  if (provisional.some((allocation) => allocation.atoms === 0n)) {
    throw new Error(
      "Asset precision cannot allocate a positive amount to every core.",
    );
  }

  return provisional
    .sort((left, right) => left.coreId.localeCompare(right.coreId))
    .map((allocation) => ({
      coreId: allocation.coreId,
      amount: allocation.atoms.toString(),
      percentage: allocation.percentage,
      points: allocation.points,
    }));
}

function normalizeAllocations(
  input: ManualTournamentPayoutInput,
  totalAtoms: bigint,
): ManualTournamentPayoutAllocation[] {
  const allocations = input.allocations ?? [];
  const coreIds = normalizeCoreIds(allocations);

  if (input.allocationMethod === "vault_unallocated") {
    if (allocations.length !== 0) {
      throw new Error("Vault-level payout cannot contain core allocations.");
    }
    return [];
  }
  if (allocations.length === 0) {
    throw new Error("Core allocations are required for this method.");
  }

  if (input.allocationMethod === "single_core") {
    if (allocations.length !== 1) {
      throw new Error("Single-core allocation requires exactly one core.");
    }
    return [
      {
        coreId: coreIds[0]!,
        amount: totalAtoms.toString(),
        percentage: "100",
        points: null,
      },
    ];
  }

  if (input.allocationMethod === "equal") {
    return apportion(
      totalAtoms,
      coreIds.map((coreId) => ({
        coreId,
        weight: 1n,
        percentage: null,
        points: null,
      })),
    );
  }

  if (input.allocationMethod === "manual_amounts") {
    const normalized = allocations.map((allocation, index) => {
      if (
        allocation.amount === undefined ||
        allocation.percentage !== undefined ||
        allocation.points !== undefined
      ) {
        throw new Error("Manual-amount allocation evidence is invalid.");
      }
      return {
        coreId: coreIds[index]!,
        atoms: toAtoms(allocation.amount, input.assetDecimalPlaces),
      };
    });
    if (
      normalized.reduce((sum, allocation) => sum + allocation.atoms, 0n) !==
      totalAtoms
    ) {
      throw new Error("Manual allocations must equal the payout amount.");
    }
    return normalized
      .sort((left, right) => left.coreId.localeCompare(right.coreId))
      .map((allocation) => ({
        coreId: allocation.coreId,
        amount: allocation.atoms.toString(),
        percentage: null,
        points: null,
      }));
  }

  if (input.allocationMethod === "manual_percentages") {
    const percentageValues = allocations.map((allocation) => {
      if (
        allocation.percentage === undefined ||
        allocation.amount !== undefined ||
        allocation.points !== undefined
      ) {
        throw new Error("Percentage allocation evidence is invalid.");
      }
      return normalizeExactDecimal(allocation.percentage);
    });
    const scale = commonScale([...percentageValues, "100"]);
    const hundred = exactWeight("100", scale, "Allocation percentage");
    const weights = percentageValues.map((value) =>
      exactWeight(value, scale, "Allocation percentage"),
    );
    if (weights.reduce((sum, weight) => sum + weight, 0n) !== hundred) {
      throw new Error("Allocation percentages must total exactly 100.");
    }
    return apportion(
      totalAtoms,
      allocations.map((allocation, index) => ({
        coreId: coreIds[index]!,
        weight: weights[index]!,
        percentage: percentageValues[index]!,
        points: null,
      })),
    );
  }

  if (input.allocationMethod === "documented_points") {
    return apportion(
      totalAtoms,
      allocations.map((allocation, index) => {
        if (
          allocation.points === undefined ||
          allocation.amount !== undefined ||
          allocation.percentage !== undefined ||
          !unsignedIntegerPattern.test(allocation.points.trim()) ||
          BigInt(allocation.points.trim()) === 0n
        ) {
          throw new Error("Documented-points allocation evidence is invalid.");
        }
        const points = BigInt(allocation.points.trim());
        return {
          coreId: coreIds[index]!,
          weight: points,
          percentage: null,
          points: points.toString(),
        };
      }),
    );
  }

  throw new Error("Payout allocation method is invalid.");
}

export function createManualTournamentPayout(
  input: ManualTournamentPayoutInput,
  context: Readonly<{
    serverNow: string;
    assetDefinition: TournamentPayoutAssetDefinition;
    assetRegistryVersion: string;
    tournamentCampaignBinding: TournamentPayoutCampaignBinding;
  }>,
): ManualTournamentPayout {
  if (!stageValues.includes(input.stage)) {
    throw new Error("Payout stage is invalid.");
  }
  if (
    !manualTournamentPayoutAllocationMethods.includes(input.allocationMethod)
  ) {
    throw new Error("Payout allocation method is invalid.");
  }
  const serverNow = normalizeContextTimestamp(context.serverNow, "Server time");
  const occurredAt = normalizeTimestamp(input.occurredAt);
  if (Date.parse(occurredAt) > Date.parse(serverNow)) {
    throw new Error("Payout timestamp cannot be in the future.");
  }
  const assetRegistryVersion = requiredTrimmed(
    context.assetRegistryVersion,
    "Asset registry version",
  );
  const authoritativeAssetCode = context.assetDefinition.code
    .trim()
    .toUpperCase();
  if (
    !assetCodePattern.test(authoritativeAssetCode) ||
    authoritativeAssetCode === "BGC" ||
    !["crypto", "fiat"].includes(context.assetDefinition.kind) ||
    !Number.isInteger(context.assetDefinition.precision) ||
    context.assetDefinition.precision < 0 ||
    context.assetDefinition.precision > 30
  ) {
    throw new Error("Authoritative tournament payout asset is invalid.");
  }
  if (
    input.assetCode.trim().toUpperCase() !== authoritativeAssetCode ||
    input.assetKind !== context.assetDefinition.kind ||
    input.assetDecimalPlaces !== context.assetDefinition.precision
  ) {
    throw new Error(
      "Tournament payout asset metadata does not match the authoritative registry.",
    );
  }
  if (
    !Number.isInteger(input.assetDecimalPlaces) ||
    input.assetDecimalPlaces < 0 ||
    input.assetDecimalPlaces > 30
  ) {
    throw new Error("Asset decimal places must be an integer from 0 to 30.");
  }

  const assetCode = authoritativeAssetCode;
  const tournamentId = requiredTrimmed(input.tournamentId, "Tournament ID");
  const boundTournamentId = requiredTrimmed(
    context.tournamentCampaignBinding.tournamentId,
    "Bound tournament ID",
  );
  if (boundTournamentId !== tournamentId) {
    throw new Error("Tournament campaign binding does not match the payout.");
  }
  const ownerAcknowledgedAt = normalizeContextTimestamp(
    context.tournamentCampaignBinding.ownerAcknowledgedAt,
    "Tournament owner acknowledgement",
  );
  if (Date.parse(ownerAcknowledgedAt) > Date.parse(serverNow)) {
    throw new Error(
      "Tournament owner acknowledgement cannot be in the future.",
    );
  }
  const tournamentCampaignBinding: TournamentPayoutCampaignBinding = {
    tournamentId: boundTournamentId,
    evidenceId: requiredTrimmed(
      context.tournamentCampaignBinding.evidenceId,
      "Tournament campaign evidence ID",
    ),
    configurationVersion: requiredTrimmed(
      context.tournamentCampaignBinding.configurationVersion,
      "Tournament configuration version",
    ),
    ownerAcknowledgedAt,
  };
  const amount = normalizeExactDecimal(input.amount);
  const totalAtoms = toAtoms(amount, input.assetDecimalPlaces);
  const allocations = normalizeAllocations(input, totalAtoms).map(
    (allocation) => ({
      ...allocation,
      amount: formatAtoms(BigInt(allocation.amount), input.assetDecimalPlaces),
    }),
  );

  return {
    payoutId: requiredTrimmed(input.payoutId, "Payout ID"),
    occurredAt,
    tournamentId,
    season: optionalTrimmed(input.season),
    bracketId: optionalTrimmed(input.bracketId),
    leaderboardId: optionalTrimmed(input.leaderboardId),
    stage: input.stage,
    amount,
    assetCode,
    assetKind: context.assetDefinition.kind as "crypto" | "fiat",
    assetDecimalPlaces: context.assetDefinition.precision,
    assetRegistryVersion,
    tournamentCampaignBinding,
    tournamentAggregationEligible: true,
    receivingAccountLabel: optionalTrimmed(input.receivingAccountLabel),
    externalReference: optionalTrimmed(input.externalReference),
    evidenceNote: optionalTrimmed(input.evidenceNote),
    sourceType: "manual_tournament_payout",
    allocationMethod: input.allocationMethod,
    allocationStatus:
      allocations.length === 0
        ? "vault_unallocated"
        : "explicit_core_allocations",
    allocations,
    allocatedAmount:
      allocations.length === 0
        ? "0"
        : formatAtoms(
            allocations.reduce(
              (sum, allocation) =>
                sum + toAtoms(allocation.amount, input.assetDecimalPlaces),
              0n,
            ),
            input.assetDecimalPlaces,
          ),
    unallocatedAmount:
      allocations.length === 0
        ? amount
        : formatAtoms(0n, input.assetDecimalPlaces),
    duplicateReviewRequired: true,
    operatingIncome: true,
  };
}
