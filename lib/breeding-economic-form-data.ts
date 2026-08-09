import {
  classifyBreedingEconomicEvidence,
  type BreedingEconomicAssetKind,
  type BreedingEconomicEvidenceInput,
} from "@/domain/breeding-economic-evidence";
import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";
import {
  buildOffspringCostBasis,
  type OffspringCostBasisInput,
  type PairingCostInput,
  type PairingRefundInput,
} from "@/domain/offspring-cost-basis";

const EVIDENCE_FIELDS = new Set([
  "breedingEventId",
  "occurredAt",
  "lifecycle",
  "parentCoreIdA",
  "parentCoreIdB",
  "offspringCoreId",
  "category",
  "assetCode",
  "amount",
  "externalReference",
  "evidenceNote",
]);

const COST_BASIS_FIELDS = new Set([
  "offspringCoreId",
  "breedingEventId",
  "transactionId",
]);

const EVIDENCE_LIFECYCLES = ["completed", "refunded"] as const;
const EVIDENCE_CATEGORIES = [
  "dna_base_fee",
  "external_arena_fee",
  "arena_fee_bgc",
  "breeding_fee_earned",
  "refund",
] as const;
const ASSET_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,15}$/;
const DURABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

type CostBasisRequest = Omit<
  OffspringCostBasisInput,
  "previouslyAssignedTransactionIds"
>;

export type BreedingEconomicFormAsset = Readonly<{
  code: string;
  kind: BreedingEconomicAssetKind;
}>;

export type ConfirmedBreedingEvent = Readonly<{
  breedingEventId: string;
  occurredAt: string;
  status: "completed";
}>;

export type ConfirmedPairingCost = PairingCostInput &
  Readonly<{ breedingEventId: string }>;

export type ConfirmedPairingRefund = PairingRefundInput &
  Readonly<{ breedingEventId: string }>;

export type BreedingEconomicFormConfiguration = Readonly<{
  assets: readonly BreedingEconomicFormAsset[];
  confirmedOwnedCoreIds: readonly string[];
  completedBreedingEvents: readonly ConfirmedBreedingEvent[];
  confirmedCosts: readonly ConfirmedPairingCost[];
  confirmedRefunds: readonly ConfirmedPairingRefund[];
  createDurableId: (
    kind:
      | "breeding_economic_evidence"
      | "breeding_economic_transaction"
      | "offspring_cost_basis",
  ) => string;
  now: () => Date;
}>;

class StrictFormData {
  readonly values = new Map<string, string[]>();

  constructor(formData: FormData, allowedFields: ReadonlySet<string>) {
    for (const [name, value] of formData.entries()) {
      if (!allowedFields.has(name)) {
        throw new Error(`Unexpected form field: ${name}.`);
      }
      if (typeof value !== "string") {
        throw new Error(`${name} must be text.`);
      }
      const values = this.values.get(name) ?? [];
      values.push(value);
      this.values.set(name, values);
    }
  }

  required(name: string, maximumLength: number): string {
    const values = this.values.get(name) ?? [];
    if (values.length !== 1) {
      throw new Error(`${name} must be supplied exactly once.`);
    }
    return bounded(values[0]!, name, maximumLength, true);
  }

  optional(name: string, maximumLength: number): string | null {
    const values = this.values.get(name) ?? [];
    if (values.length > 1) {
      throw new Error(`${name} must not be repeated.`);
    }
    if (values.length === 0) return null;
    const value = bounded(values[0]!, name, maximumLength, false);
    return value === "" ? null : value;
  }

  repeated(
    name: string,
    maximumLength: number,
    maximumCount: number,
  ): string[] {
    const values = this.values.get(name) ?? [];
    if (values.length > maximumCount) {
      throw new Error(`${name} exceeds the supported item count.`);
    }
    return values.map((value) => bounded(value, name, maximumLength, true));
  }
}

function bounded(
  value: string,
  label: string,
  maximumLength: number,
  required: boolean,
): string {
  const normalized = value.trim();
  if (required && normalized === "") throw new Error(`${label} is required.`);
  if (normalized.length > maximumLength) {
    throw new Error(`${label} is too long.`);
  }
  return normalized;
}

function enumValue<const T extends readonly string[]>(
  value: string,
  values: T,
  label: string,
): T[number] {
  if (!values.includes(value)) throw new Error(`${label} is invalid.`);
  return value as T[number];
}

function timestamp(value: string, label: string): string {
  if (!OFFSET_TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`${label} must include an explicit UTC offset.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} is invalid.`);
  return new Date(parsed).toISOString();
}

function positiveDecimal(value: string, label: string): string {
  let normalized: string;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    throw new Error(`${label} must be a plain base-10 decimal.`);
  }
  if (isNegativeExactDecimal(normalized) || isZeroExactDecimal(normalized)) {
    throw new Error(`${label} must be positive.`);
  }
  return normalized;
}

function durableId(
  configuration: BreedingEconomicFormConfiguration,
  kind: Parameters<BreedingEconomicFormConfiguration["createDurableId"]>[0],
): string {
  const value = configuration.createDurableId(kind).trim();
  if (!DURABLE_ID_PATTERN.test(value)) {
    throw new Error("Generated durable breeding evidence ID is invalid.");
  }
  return value;
}

function configuredAssets(
  configuration: BreedingEconomicFormConfiguration,
): ReadonlyMap<string, BreedingEconomicFormAsset> {
  const assets = new Map<string, BreedingEconomicFormAsset>();
  for (const candidate of configuration.assets) {
    const code = candidate.code.trim().toUpperCase();
    if (
      !ASSET_CODE_PATTERN.test(code) ||
      !["crypto", "fiat", "game_credit"].includes(candidate.kind) ||
      assets.has(code) ||
      (code === "BGC" && candidate.kind !== "game_credit") ||
      (code !== "BGC" && candidate.kind === "game_credit")
    ) {
      throw new Error("Breeding economic asset configuration is invalid.");
    }
    assets.set(code, { code, kind: candidate.kind });
  }
  if (assets.size === 0) {
    throw new Error("Breeding economic asset configuration is required.");
  }
  return assets;
}

function configuredAsset(
  form: StrictFormData,
  configuration: BreedingEconomicFormConfiguration,
): BreedingEconomicFormAsset {
  const code = form.required("assetCode", 16).toUpperCase();
  const asset = configuredAssets(configuration).get(code);
  if (asset === undefined) {
    throw new Error("Breeding economic asset is not configured.");
  }
  return asset;
}

function uniqueConfigurationMap<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const identity = key(value).trim();
    if (identity === "" || result.has(identity)) {
      throw new Error(`${label} configuration is invalid.`);
    }
    result.set(identity, value);
  }
  return result;
}

function now(configuration: BreedingEconomicFormConfiguration): string {
  const value = configuration.now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Breeding economic request time is invalid.");
  }
  return value.toISOString();
}

export function parseBreedingEconomicEvidenceFormData(
  formData: FormData,
  configuration: BreedingEconomicFormConfiguration,
): BreedingEconomicEvidenceInput {
  const form = new StrictFormData(formData, EVIDENCE_FIELDS);
  const asset = configuredAsset(form, configuration);
  const lifecycle = enumValue(
    form.required("lifecycle", 16),
    EVIDENCE_LIFECYCLES,
    "Breeding evidence lifecycle",
  );
  const category = enumValue(
    form.required("category", 32),
    EVIDENCE_CATEGORIES,
    "Breeding economic category",
  );
  if (
    (lifecycle === "refunded" && category !== "refund") ||
    (lifecycle === "completed" && category === "refund")
  ) {
    throw new Error(
      "Breeding lifecycle and economic category are inconsistent.",
    );
  }
  const parentCoreIds = [
    form.required("parentCoreIdA", 128),
    form.required("parentCoreIdB", 128),
  ] as const;
  if (parentCoreIds[0] === parentCoreIds[1]) {
    throw new Error("Breeding evidence requires two distinct parents.");
  }
  const direction =
    category === "breeding_fee_earned" || category === "refund"
      ? "credit"
      : "debit";
  const evidenceNote = form.required("evidenceNote", 1_000);
  const input: BreedingEconomicEvidenceInput = {
    evidenceId: durableId(configuration, "breeding_economic_evidence"),
    breedingEventId: form.required("breedingEventId", 128),
    source: "manual_confirmed",
    lifecycle,
    occurredAt: timestamp(
      form.required("occurredAt", 40),
      "Breeding occurrence time",
    ),
    parentCoreIds,
    offspringCoreId: form.optional("offspringCoreId", 128),
    evidenceNote,
    entries: [
      {
        transactionId: durableId(
          configuration,
          "breeding_economic_transaction",
        ),
        category,
        direction,
        assetCode: asset.code,
        assetKind: asset.kind,
        amount: positiveDecimal(
          form.required("amount", 256),
          "Breeding economic amount",
        ),
        externalReference: form.optional("externalReference", 256),
      },
    ],
  };

  classifyBreedingEconomicEvidence(input);
  return input;
}

export function parseOffspringCostBasisFormData(
  formData: FormData,
  configuration: BreedingEconomicFormConfiguration,
): CostBasisRequest {
  const form = new StrictFormData(formData, COST_BASIS_FIELDS);
  const assets = configuredAssets(configuration);
  const offspringCoreId = form.required("offspringCoreId", 128);
  const ownedCoreIds = new Set(
    configuration.confirmedOwnedCoreIds.map((coreId) => coreId.trim()),
  );
  if (
    ownedCoreIds.size !== configuration.confirmedOwnedCoreIds.length ||
    ownedCoreIds.has("")
  ) {
    throw new Error("Confirmed owned-core configuration is invalid.");
  }
  if (!ownedCoreIds.has(offspringCoreId)) {
    throw new Error("Offspring ownership is not confirmed.");
  }

  const breedingEventId = form.required("breedingEventId", 128);
  const events = uniqueConfigurationMap(
    configuration.completedBreedingEvents,
    (event) => event.breedingEventId,
    "Completed breeding event",
  );
  const event = events.get(breedingEventId);
  if (event === undefined || event.status !== "completed") {
    throw new Error("Breeding event is not confirmed complete.");
  }
  const breedingOccurredAt = timestamp(
    event.occurredAt,
    "Configured breeding occurrence time",
  );

  const costById = uniqueConfigurationMap(
    configuration.confirmedCosts,
    (cost) => cost.transactionId,
    "Confirmed pairing cost",
  );
  const refundById = uniqueConfigurationMap(
    configuration.confirmedRefunds,
    (refund) => refund.transactionId,
    "Confirmed pairing refund",
  );
  for (const transactionId of costById.keys()) {
    if (refundById.has(transactionId)) {
      throw new Error(
        "Confirmed pairing transaction configuration is invalid.",
      );
    }
  }
  const transactionIds = form.repeated("transactionId", 128, 100);
  if (transactionIds.length === 0) {
    throw new Error("At least one confirmed pairing cost is required.");
  }
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new Error("Cost-basis transaction IDs must be unique.");
  }
  const costs: ConfirmedPairingCost[] = [];
  const refunds: ConfirmedPairingRefund[] = [];
  for (const transactionId of transactionIds) {
    const cost = costById.get(transactionId);
    const refund = refundById.get(transactionId);
    const selected = cost ?? refund;
    if (selected === undefined) {
      throw new Error("Cost-basis transaction is not confirmed.");
    }
    if (selected.breedingEventId.trim() !== breedingEventId) {
      throw new Error(
        "Cost-basis transaction belongs to another breeding event.",
      );
    }
    if (
      selected.source !== "manual_confirmed" &&
      selected.source !== "authoritative_transaction_export"
    ) {
      throw new Error("Cost-basis transaction source is invalid.");
    }
    if (selected.evidenceStatus !== "confirmed") {
      throw new Error("Cost-basis transaction is not confirmed.");
    }
    const asset = assets.get(selected.assetCode.trim().toUpperCase());
    if (asset === undefined || asset.kind !== selected.assetKind) {
      throw new Error(
        "Cost-basis transaction asset is not configured consistently.",
      );
    }
    if (cost !== undefined) costs.push(cost);
    else refunds.push(refund!);
  }
  if (costs.length === 0) {
    throw new Error("At least one confirmed pairing cost is required.");
  }
  const selectedCostIds = new Set(costs.map((cost) => cost.transactionId));
  if (
    refunds.some(
      (refund) => !selectedCostIds.has(refund.appliesToTransactionId),
    )
  ) {
    throw new Error("Every selected refund requires its pairing cost.");
  }
  const requestedAt = now(configuration);
  if (Date.parse(requestedAt) < Date.parse(breedingOccurredAt)) {
    throw new Error("Cost-basis request cannot predate breeding.");
  }

  const request: CostBasisRequest = {
    assignmentId: durableId(configuration, "offspring_cost_basis"),
    offspringCoreId,
    breedingEventId,
    breedingOccurredAt,
    requestedAt,
    ownershipStatus: "confirmed_owned",
    breedingEventStatus: "completed",
    costs: costs
      .map((cost) => ({
        transactionId: cost.transactionId,
        category: cost.category,
        source: cost.source,
        evidenceStatus: cost.evidenceStatus,
        assetCode: cost.assetCode,
        assetKind: cost.assetKind,
        amount: cost.amount,
      }))
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
    refunds: refunds
      .map((refund) => ({
        transactionId: refund.transactionId,
        appliesToTransactionId: refund.appliesToTransactionId,
        source: refund.source,
        evidenceStatus: refund.evidenceStatus,
        assetCode: refund.assetCode,
        assetKind: refund.assetKind,
        amount: refund.amount,
      }))
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
  };

  buildOffspringCostBasis({
    ...request,
    previouslyAssignedTransactionIds: [],
  });
  return request;
}
