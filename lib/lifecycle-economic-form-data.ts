import {
  reconcileBurnCredit,
  type BurnCreditEvidence,
  type ConfirmedBurnEvidence,
} from "@/domain/burn-credit-reconciliation";
import {
  assessCoreBurnEvent,
  type CoreBurnEventInput,
} from "@/domain/core-burn-event";
import {
  assessCoreSaleEvidence,
  type CoreSaleEvidenceInput,
} from "@/domain/core-sale-evidence";
import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";

const SALE_FIELDS = new Set([
  "coreId",
  "occurredAt",
  "proceedsAsset",
  "proceedsAmount",
  "sellingFees",
  "acquisitionCost",
  "externalReference",
]);
const BURN_FIELDS = new Set(["coreId", "coreClass", "occurredAt", "reason"]);
const CREDIT_FIELDS = new Set([
  "burnId",
  "coreId",
  "occurredAt",
  "amount",
  "externalReference",
]);
const CORE_CLASSES = ["Genesis", "Morphed", "Freak", "X-Class"] as const;
const ASSET_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,15}$/;
const DURABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type ActiveLifecycleCore = Readonly<{
  coreId: string;
  coreClass: CoreBurnEventInput["coreClass"];
}>;

export type LifecycleEconomicFormConfiguration = Readonly<{
  assets: readonly string[];
  activeCores: readonly ActiveLifecycleCore[];
  confirmedBurns: readonly ConfirmedBurnEvidence[];
  createDurableId: (
    kind: "core_sale" | "core_burn" | "burn_bgc_credit",
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
  configuration: LifecycleEconomicFormConfiguration,
  kind: Parameters<LifecycleEconomicFormConfiguration["createDurableId"]>[0],
): string {
  const value = configuration.createDurableId(kind).trim();
  if (!DURABLE_ID_PATTERN.test(value)) {
    throw new Error("Generated durable lifecycle evidence ID is invalid.");
  }
  return value;
}

function configuredAssets(
  configuration: LifecycleEconomicFormConfiguration,
): ReadonlySet<string> {
  const assets = configuration.assets.map((asset) =>
    asset.trim().toUpperCase(),
  );
  if (
    assets.length === 0 ||
    new Set(assets).size !== assets.length ||
    assets.some((asset) => !ASSET_CODE_PATTERN.test(asset))
  ) {
    throw new Error("Lifecycle economic asset configuration is invalid.");
  }
  return new Set(assets);
}

function configuredAsset(
  form: StrictFormData,
  configuration: LifecycleEconomicFormConfiguration,
): string {
  const asset = form.required("proceedsAsset", 16).toUpperCase();
  if (!configuredAssets(configuration).has(asset)) {
    throw new Error("Sale proceeds asset is not configured.");
  }
  return asset;
}

function activeCoreMap(
  configuration: LifecycleEconomicFormConfiguration,
): ReadonlyMap<string, ActiveLifecycleCore> {
  const cores = new Map<string, ActiveLifecycleCore>();
  for (const candidate of configuration.activeCores) {
    const coreId = candidate.coreId.trim();
    if (
      coreId === "" ||
      cores.has(coreId) ||
      !CORE_CLASSES.includes(candidate.coreClass)
    ) {
      throw new Error("Active lifecycle core configuration is invalid.");
    }
    cores.set(coreId, { ...candidate, coreId });
  }
  return cores;
}

function activeCore(
  coreId: string,
  configuration: LifecycleEconomicFormConfiguration,
): ActiveLifecycleCore {
  const core = activeCoreMap(configuration).get(coreId);
  if (core === undefined) {
    throw new Error("Active ownership is not confirmed for this core.");
  }
  return core;
}

function confirmedBurnMap(
  configuration: LifecycleEconomicFormConfiguration,
): ReadonlyMap<string, ConfirmedBurnEvidence> {
  const burns = new Map<string, ConfirmedBurnEvidence>();
  for (const candidate of configuration.confirmedBurns) {
    const burnId = candidate.burnId.trim();
    const coreId = candidate.coreId.trim();
    if (
      burnId === "" ||
      coreId === "" ||
      burns.has(burnId) ||
      candidate.status !== "confirmed_event_review"
    ) {
      throw new Error("Confirmed burn configuration is invalid.");
    }
    burns.set(burnId, {
      burnId,
      coreId,
      occurredAt: timestamp(
        candidate.occurredAt,
        "Configured burn occurrence time",
      ),
      status: "confirmed_event_review",
    });
  }
  return burns;
}

function recordedAt(
  configuration: LifecycleEconomicFormConfiguration,
  occurredAt: string,
): string {
  const value = configuration.now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Lifecycle evidence record time is invalid.");
  }
  const normalized = value.toISOString();
  if (Date.parse(normalized) < Date.parse(occurredAt)) {
    throw new Error(
      "Lifecycle evidence cannot be recorded before it occurred.",
    );
  }
  return normalized;
}

export function parseCoreSaleFormData(
  formData: FormData,
  configuration: LifecycleEconomicFormConfiguration,
): CoreSaleEvidenceInput {
  const form = new StrictFormData(formData, SALE_FIELDS);
  const coreId = form.required("coreId", 128);
  activeCore(coreId, configuration);
  const occurredAt = timestamp(form.required("occurredAt", 40), "Sale time");
  const proceedsAsset = configuredAsset(form, configuration);
  const sellingFees = form.optional("sellingFees", 256);
  const acquisitionCost = form.optional("acquisitionCost", 256);
  const input: CoreSaleEvidenceInput = {
    saleId: durableId(configuration, "core_sale"),
    coreId,
    occurredAt,
    recordedAt: recordedAt(configuration, occurredAt),
    evidenceSource: "manual",
    evidenceStatus: "confirmed",
    ownershipAtSale: "confirmed_active",
    proceeds: {
      asset: proceedsAsset,
      amount: positiveDecimal(
        form.required("proceedsAmount", 256),
        "Sale proceeds",
      ),
    },
    sellingFees:
      sellingFees === null
        ? []
        : [
            {
              asset: proceedsAsset,
              amount: positiveDecimal(sellingFees, "Selling fees"),
            },
          ],
    acquisitionCost:
      acquisitionCost === null
        ? null
        : {
            asset: proceedsAsset,
            amount: positiveDecimal(acquisitionCost, "Acquisition cost"),
          },
    externalReference: form.optional("externalReference", 256),
    recommendationReferenceId: null,
  };

  assessCoreSaleEvidence(input);
  return input;
}

export function parseCoreBurnFormData(
  formData: FormData,
  configuration: LifecycleEconomicFormConfiguration,
): CoreBurnEventInput {
  const form = new StrictFormData(formData, BURN_FIELDS);
  const coreId = form.required("coreId", 128);
  const core = activeCore(coreId, configuration);
  const submittedClass = form.required("coreClass", 16);
  if (submittedClass !== core.coreClass) {
    throw new Error(
      "Submitted core class does not match accepted core evidence.",
    );
  }
  if (core.coreClass === "Genesis") {
    throw new Error("Genesis cores cannot be burned.");
  }
  const occurredAt = timestamp(form.required("occurredAt", 40), "Burn time");
  const input: CoreBurnEventInput = {
    burnId: durableId(configuration, "core_burn"),
    coreId,
    coreClass: core.coreClass,
    occurredAt,
    recordedAt: recordedAt(configuration, occurredAt),
    evidenceSource: "manual",
    evidenceStatus: "confirmed",
    ownershipAtBurn: "confirmed_active",
    reason: form.required("reason", 1_000),
    recommendationReferenceId: null,
  };

  assessCoreBurnEvent(input);
  return input;
}

export function parseBurnCreditFormData(
  formData: FormData,
  configuration: LifecycleEconomicFormConfiguration,
): BurnCreditEvidence {
  const form = new StrictFormData(formData, CREDIT_FIELDS);
  const burnId = form.required("burnId", 128);
  const burn = confirmedBurnMap(configuration).get(burnId);
  if (burn === undefined) {
    throw new Error("Burn is not confirmed.");
  }
  const coreId = form.required("coreId", 128);
  if (coreId !== burn.coreId) {
    throw new Error("Burn credit core does not match the confirmed burn.");
  }
  const credit: BurnCreditEvidence = {
    creditId: durableId(configuration, "burn_bgc_credit"),
    coreId: burn.coreId,
    burnId: burn.burnId,
    occurredAt: timestamp(form.required("occurredAt", 40), "BGC credit time"),
    asset: "BGC",
    amount: positiveDecimal(form.required("amount", 256), "Actual BGC credit"),
    evidenceSource: "manual",
    evidenceStatus: "confirmed",
    externalReference: form.optional("externalReference", 256),
  };
  const reconciliation = reconcileBurnCredit({ burn, credits: [credit] });
  if (reconciliation.status !== "matched_actual_credit") {
    throw new Error(
      "Actual BGC credit does not reconcile to the confirmed burn.",
    );
  }
  return credit;
}
