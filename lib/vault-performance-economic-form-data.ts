import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";
import {
  manualLedgerCategories,
  manualLedgerSubcategories,
  validateManualLedgerEntry,
  type ManualLedgerEntryInput,
  type ManualLedgerSubcategory as DomainManualLedgerSubcategory,
} from "@/domain/manual-ledger";
import {
  createManualTournamentPayout,
  manualTournamentPayoutAllocationMethods,
  type ManualTournamentPayoutInput,
} from "@/domain/manual-tournament-payout";

const MANUAL_LEDGER_FIELDS = new Set([
  "occurredAt",
  "assetCode",
  "assetKind",
  "amount",
  "category",
  "subcategory",
  "direction",
  "accountLabel",
  "fromAccountLabel",
  "toAccountLabel",
  "tournamentId",
  "coreId",
  "externalReference",
  "costBasisStatus",
  "note",
]);

const TOURNAMENT_PAYOUT_FIELDS = new Set([
  "occurredAt",
  "tournamentId",
  "season",
  "bracketId",
  "leaderboardId",
  "stage",
  "amount",
  "assetCode",
  "receivingAccountLabel",
  "externalReference",
  "evidenceNote",
  "allocationMethod",
]);

const PAYOUT_STAGE_VALUES = [
  "qualification",
  "round",
  "final",
  "overall_prize",
  "other",
] as const;

const COST_BASIS_VALUES = ["known", "missing", "not_applicable"] as const;
const DIRECTION_VALUES = ["credit", "debit"] as const;
const ASSET_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,15}$/;
const SUBCATEGORY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const DURABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

type ManualLedgerCategory = ManualLedgerEntryInput["category"];
type ManualLedgerAssetKind = ManualLedgerEntryInput["assetKind"];
type PayoutAssetKind = ManualTournamentPayoutInput["assetKind"];

export type EconomicFormAsset = Readonly<{
  code: string;
  kind: ManualLedgerAssetKind;
  decimalPlaces: number;
}>;

export type ManualLedgerSubcategoryConfiguration = Readonly<{
  category: ManualLedgerCategory;
  subcategory: DomainManualLedgerSubcategory;
}>;

export type VaultPerformanceEconomicFormConfiguration = Readonly<{
  assets: readonly EconomicFormAsset[];
  manualLedgerSubcategories: readonly ManualLedgerSubcategoryConfiguration[];
  createDurableId: (
    kind: "manual_ledger_entry" | "manual_tournament_payout",
  ) => string;
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
    const normalized = bounded(values[0]!, name, maximumLength, false);
    return normalized === "" ? null : normalized;
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
  if (required && normalized === "") {
    throw new Error(`${label} is required.`);
  }
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
  if (!values.includes(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T[number];
}

function timestamp(value: string, label: string): string {
  if (!OFFSET_TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`${label} must include an explicit UTC offset.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} is invalid.`);
  }
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

function configurationAssets(
  configuration: VaultPerformanceEconomicFormConfiguration,
): ReadonlyMap<string, EconomicFormAsset> {
  const assets = new Map<string, EconomicFormAsset>();
  for (const candidate of configuration.assets) {
    const code = candidate.code.trim().toUpperCase();
    if (
      !ASSET_CODE_PATTERN.test(code) ||
      !["crypto", "fiat", "game_credit"].includes(candidate.kind) ||
      !Number.isInteger(candidate.decimalPlaces) ||
      candidate.decimalPlaces < 0 ||
      candidate.decimalPlaces > 30 ||
      assets.has(code)
    ) {
      throw new Error("Economic form asset configuration is invalid.");
    }
    if (
      (code === "BGC" && candidate.kind !== "game_credit") ||
      (code !== "BGC" && candidate.kind === "game_credit")
    ) {
      throw new Error("BGC asset configuration is invalid.");
    }
    assets.set(code, { ...candidate, code });
  }
  if (assets.size === 0) {
    throw new Error("Economic form asset configuration is required.");
  }
  return assets;
}

function configuredAsset(
  form: StrictFormData,
  configuration: VaultPerformanceEconomicFormConfiguration,
): EconomicFormAsset {
  const code = form.required("assetCode", 16).toUpperCase();
  if (!ASSET_CODE_PATTERN.test(code)) {
    throw new Error("Asset code is invalid.");
  }
  const asset = configurationAssets(configuration).get(code);
  if (asset === undefined) {
    throw new Error("Asset code is not configured.");
  }
  return asset;
}

function configuredSubcategories(
  configuration: VaultPerformanceEconomicFormConfiguration,
): ReadonlySet<string> {
  const subcategories = new Set<string>();
  for (const candidate of configuration.manualLedgerSubcategories) {
    if (
      !manualLedgerCategories.includes(candidate.category) ||
      !SUBCATEGORY_PATTERN.test(candidate.subcategory) ||
      subcategories.has(`${candidate.category}:${candidate.subcategory}`)
    ) {
      throw new Error("Manual ledger subcategory configuration is invalid.");
    }
    subcategories.add(`${candidate.category}:${candidate.subcategory}`);
  }
  if (subcategories.size === 0) {
    throw new Error("Manual ledger subcategory configuration is required.");
  }
  return subcategories;
}

function durableId(
  configuration: VaultPerformanceEconomicFormConfiguration,
  kind: Parameters<
    VaultPerformanceEconomicFormConfiguration["createDurableId"]
  >[0],
): string {
  const id = configuration.createDurableId(kind).trim();
  if (!DURABLE_ID_PATTERN.test(id)) {
    throw new Error("Generated durable economic evidence ID is invalid.");
  }
  return id;
}

function unique(values: readonly string[], label: string): string[] {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
  return [...values].sort();
}

export function parseManualLedgerFormData(
  formData: FormData,
  configuration: VaultPerformanceEconomicFormConfiguration,
): ManualLedgerEntryInput {
  const form = new StrictFormData(formData, MANUAL_LEDGER_FIELDS);
  const asset = configuredAsset(form, configuration);
  const submittedKind = enumValue(
    form.required("assetKind", 24),
    ["crypto", "fiat", "game_credit"] as const,
    "Asset kind",
  );
  if (submittedKind !== asset.kind) {
    throw new Error("Asset kind does not match server configuration.");
  }

  const category = enumValue(
    form.required("category", 32),
    manualLedgerCategories,
    "Manual ledger category",
  );
  const subcategory = enumValue(
    form.required("subcategory", 64),
    manualLedgerSubcategories,
    "Manual ledger subcategory",
  );
  if (!SUBCATEGORY_PATTERN.test(subcategory)) {
    throw new Error("Manual ledger subcategory is invalid.");
  }
  if (
    !configuredSubcategories(configuration).has(`${category}:${subcategory}`)
  ) {
    throw new Error(
      "Manual ledger category and subcategory are not configured.",
    );
  }
  const directionValue = form.optional("direction", 8);
  const direction =
    directionValue === null
      ? undefined
      : enumValue(directionValue, DIRECTION_VALUES, "Posting direction");
  const expectedDirection =
    category === "expense" || category === "withdrawal"
      ? "debit"
      : category === "adjustment" || category === "transfer"
        ? null
        : "credit";
  if (
    expectedDirection !== null &&
    direction !== undefined &&
    direction !== expectedDirection
  ) {
    throw new Error("Posting direction conflicts with the ledger category.");
  }
  if (category === "adjustment" && direction === undefined) {
    throw new Error("Adjustment direction is required.");
  }
  if (category === "transfer" && direction !== undefined) {
    throw new Error("Transfer cannot contain a single posting direction.");
  }

  const accountLabel = form.optional("accountLabel", 120);
  const fromAccountLabel = form.optional("fromAccountLabel", 120);
  const toAccountLabel = form.optional("toAccountLabel", 120);
  if (category === "transfer") {
    if (
      accountLabel !== null ||
      fromAccountLabel === null ||
      toAccountLabel === null
    ) {
      throw new Error(
        "Transfer requires distinct source and destination accounts only.",
      );
    }
    if (fromAccountLabel === toAccountLabel) {
      throw new Error("Transfer accounts must be distinct.");
    }
  } else if (fromAccountLabel !== null || toAccountLabel !== null) {
    throw new Error(
      "Transfer account fields are unavailable for this ledger category.",
    );
  } else if (accountLabel === null) {
    throw new Error("accountLabel is required.");
  }

  const costBasisValue = form.optional("costBasisStatus", 24);
  const coreIds = unique(form.repeated("coreId", 128, 100), "Core IDs");
  const input: ManualLedgerEntryInput = {
    entryId: durableId(configuration, "manual_ledger_entry"),
    occurredAt: timestamp(
      form.required("occurredAt", 40),
      "Manual ledger timestamp",
    ),
    assetCode: asset.code,
    assetKind: asset.kind,
    amount: positiveDecimal(form.required("amount", 256), "Manual amount"),
    category,
    subcategory,
    ...(category === "transfer"
      ? { fromAccountLabel, toAccountLabel }
      : {
          direction: direction ?? expectedDirection!,
          accountLabel,
        }),
    tournamentId: form.optional("tournamentId", 128),
    coreIds,
    externalReference: form.optional("externalReference", 256),
    ...(costBasisValue === null
      ? {}
      : {
          costBasisStatus: enumValue(
            costBasisValue,
            COST_BASIS_VALUES,
            "Cost-basis status",
          ),
        }),
    note: form.optional("note", 1_000),
  };

  validateManualLedgerEntry(input);
  return input;
}

export function parseManualTournamentPayoutFormData(
  formData: FormData,
  configuration: VaultPerformanceEconomicFormConfiguration,
): ManualTournamentPayoutInput {
  const form = new StrictFormData(formData, TOURNAMENT_PAYOUT_FIELDS);
  const asset = configuredAsset(form, configuration);
  if (asset.kind === "game_credit" || asset.code === "BGC") {
    throw new Error("BGC cannot be recorded as a manual tournament payout.");
  }
  const allocationMethod = enumValue(
    form.required("allocationMethod", 32),
    manualTournamentPayoutAllocationMethods,
    "Payout allocation method",
  );
  if (allocationMethod !== "vault_unallocated") {
    throw new Error(
      "Core allocation form submissions remain disabled until conditional allocation controls are available.",
    );
  }

  const input: ManualTournamentPayoutInput = {
    payoutId: durableId(configuration, "manual_tournament_payout"),
    occurredAt: timestamp(
      form.required("occurredAt", 40),
      "Tournament payout timestamp",
    ),
    tournamentId: form.required("tournamentId", 128),
    season: form.optional("season", 128),
    bracketId: form.optional("bracketId", 128),
    leaderboardId: form.optional("leaderboardId", 128),
    stage: enumValue(
      form.required("stage", 32),
      PAYOUT_STAGE_VALUES,
      "Tournament payout stage",
    ),
    amount: positiveDecimal(form.required("amount", 256), "Payout amount"),
    assetCode: asset.code,
    assetKind: asset.kind as PayoutAssetKind,
    assetDecimalPlaces: asset.decimalPlaces,
    receivingAccountLabel: form.optional("receivingAccountLabel", 120),
    externalReference: form.optional("externalReference", 256),
    evidenceNote: form.optional("evidenceNote", 1_000),
    allocationMethod,
  };

  createManualTournamentPayout(input);
  return input;
}
