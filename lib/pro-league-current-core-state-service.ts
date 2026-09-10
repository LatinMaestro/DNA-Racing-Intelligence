import { deriveFreshness, type FreshnessState } from "@/domain/freshness";
import type { JsonSourceValue } from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaOpenLabServingSupplementalCore,
  DnaOpenLabSupplementalCoreReadRepository,
} from "@/lib/neon-dna-open-lab-sync-publication";

const REQUIRED_FAMILIES = Object.freeze([
  "racing_stats",
  "power",
  "listing",
  "attached_assets",
  "owner",
  "stamina",
  "splicing",
] as const);

export type ProLeagueCurrentCoreState = Readonly<{
  status:
    | "not_configured"
    | "active_generation_unavailable"
    | "invalid_generation"
    | "connected";
  latestObservedAt: string | null;
  dataCurrentThrough: string | null;
  freshness: FreshnessState;
  cores: readonly Readonly<{
    displayName: string;
    latestObservedAt: string;
    dataCurrentThrough: string;
    bikePower: Readonly<{
      powerSourceValue: JsonSourceValue;
      adjustedOddsSourceValue: JsonSourceValue;
      varianceSourceValue: JsonSourceValue;
      raceCount: number;
    }>;
    stamina: Readonly<{
      current: number;
      maximum: number;
      nextRefillAt: string | null;
    }>;
    listing: Readonly<{
      priceSourceValue?: number;
      paymentAssetSourceValue?: string;
      expiresAt?: string;
    }>;
    bikeSkinAttached: boolean;
    trailsAttached: boolean;
    racingStatsObserved: boolean;
    ownerObserved: boolean;
    splicingObserved: boolean;
  }>[];
}>;

function unavailable(
  status:
    "not_configured" | "active_generation_unavailable" | "invalid_generation",
): ProLeagueCurrentCoreState {
  return Object.freeze({
    status,
    latestObservedAt: null,
    dataCurrentThrough: null,
    freshness: "unknown",
    cores: Object.freeze([]),
  });
}

export function invalidProLeagueCurrentCoreState(): ProLeagueCurrentCoreState {
  return unavailable("invalid_generation");
}

function scalarPresent(value: JsonSourceValue | undefined): boolean {
  if (value === undefined) return false;
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function familyRow(
  rows: ReadonlyMap<string, DnaOpenLabServingSupplementalCore>,
  family: (typeof REQUIRED_FAMILIES)[number],
): DnaOpenLabServingSupplementalCore {
  const row = rows.get(family);
  if (row === undefined) {
    throw new Error(`Pro League current Core state is missing ${family}.`);
  }
  return row;
}

export async function loadProLeagueCurrentCoreState(
  input: Readonly<{
    ownerId: string;
    selectedCores: readonly Readonly<{
      sourceCoreId: string;
      displayName: string;
    }>[];
    repository: DnaOpenLabSupplementalCoreReadRepository | null;
    now?: Date;
  }>,
): Promise<ProLeagueCurrentCoreState> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Pro League current Core freshness time is invalid.");
  }
  if (input.repository === null) return unavailable("not_configured");
  const serving = await input.repository.readServingSupplementalCores({
    ownerId: input.ownerId,
  });
  if (serving.generationId === null) {
    if (serving.rows.length !== 0) {
      throw new Error(
        "Pro League current Core state has rows without an active generation.",
      );
    }
    return unavailable("active_generation_unavailable");
  }
  if (input.selectedCores.length === 0) {
    throw new Error("Pro League current Core selection is empty.");
  }

  const byCore = new Map<
    string,
    Map<string, DnaOpenLabServingSupplementalCore>
  >();
  for (const row of serving.rows) {
    if (row.generationId !== serving.generationId) {
      throw new Error("Pro League current Core state changed mid-read.");
    }
    const families = byCore.get(row.sourceCoreId) ?? new Map();
    if (families.has(row.family)) {
      throw new Error(
        "Pro League current Core state contains a duplicate family.",
      );
    }
    families.set(row.family, row);
    byCore.set(row.sourceCoreId, families);
  }

  const cores = input.selectedCores.map((selected) => {
    const rows = byCore.get(selected.sourceCoreId);
    if (rows === undefined || rows.size !== REQUIRED_FAMILIES.length) {
      throw new Error(
        `Pro League current Core state is incomplete for ${selected.displayName}.`,
      );
    }
    const racingStats = familyRow(rows, "racing_stats");
    const power = familyRow(rows, "power");
    const listing = familyRow(rows, "listing");
    const attachedAssets = familyRow(rows, "attached_assets");
    const owner = familyRow(rows, "owner");
    const stamina = familyRow(rows, "stamina");
    const splicing = familyRow(rows, "splicing");
    if (
      racingStats.canonical.sourceType !== "core_racing_stats_snapshot" ||
      power.canonical.sourceType !== "core_power_snapshot" ||
      listing.canonical.sourceType !== "core_listing_snapshot" ||
      attachedAssets.canonical.sourceType !== "core_attached_assets_snapshot" ||
      owner.canonical.sourceType !== "core_owner_snapshot" ||
      stamina.canonical.sourceType !== "core_stamina_snapshot" ||
      splicing.canonical.sourceType !== "core_splicing_snapshot"
    ) {
      throw new Error("Pro League current Core family authority is invalid.");
    }
    const observationTimes = [...rows.values()]
      .map((row) => {
        const parsed = new Date(row.observedAt);
        if (
          Number.isNaN(parsed.getTime()) ||
          parsed.toISOString() !== row.observedAt ||
          parsed.getTime() > now.getTime()
        ) {
          throw new Error(
            "Pro League current Core observation time is invalid.",
          );
        }
        return row.observedAt;
      })
      .sort();
    const latestObservedAt = observationTimes.at(-1);
    const dataCurrentThrough = observationTimes.at(0);
    if (latestObservedAt === undefined || dataCurrentThrough === undefined) {
      throw new Error(
        "Pro League current Core observation time is unavailable.",
      );
    }
    return Object.freeze({
      displayName: selected.displayName,
      latestObservedAt,
      dataCurrentThrough,
      bikePower: power.canonical.byMode.bike,
      stamina: Object.freeze({
        current: stamina.canonical.current,
        maximum: stamina.canonical.maximum,
        nextRefillAt: stamina.canonical.nextRefillAt,
      }),
      listing: Object.freeze({
        ...(listing.canonical.priceSourceValue === undefined
          ? {}
          : { priceSourceValue: listing.canonical.priceSourceValue }),
        ...(listing.canonical.paymentAssetSourceValue === undefined
          ? {}
          : {
              paymentAssetSourceValue:
                listing.canonical.paymentAssetSourceValue,
            }),
        ...(listing.canonical.expiresAt === undefined
          ? {}
          : { expiresAt: listing.canonical.expiresAt }),
      }),
      bikeSkinAttached: scalarPresent(
        attachedAssets.canonical.skinSourceValueByMode.bike,
      ),
      trailsAttached: scalarPresent(attachedAssets.canonical.trailsSourceValue),
      racingStatsObserved: true,
      ownerObserved: true,
      splicingObserved: true,
    });
  });
  const latestObservedAt = cores
    .map((core) => core.latestObservedAt)
    .sort()
    .at(-1);
  const dataCurrentThrough = cores
    .map((core) => core.dataCurrentThrough)
    .sort()
    .at(0);
  return Object.freeze({
    status: "connected",
    latestObservedAt: latestObservedAt ?? null,
    dataCurrentThrough: dataCurrentThrough ?? null,
    freshness: deriveFreshness(
      dataCurrentThrough === undefined ? null : new Date(dataCurrentThrough),
      now,
    ),
    cores: Object.freeze(cores),
  });
}
