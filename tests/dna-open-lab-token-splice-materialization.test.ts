import { describe, expect, it } from "vitest";

import {
  createDnaTokenSpliceMaterialization,
  type DnaTokenSpliceMaterialization,
} from "@/lib/dna-open-lab-token-splice-materialization";
import {
  adaptDnaSpliceArenaPage,
  adaptDnaTokenPrices,
  type CanonicalSpliceArenaPageSnapshot,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";
import type { DnaCurrentStateCandidate } from "@/lib/dna-open-lab-last-good-publication";
import type { DnaSpliceArenaCore } from "@/lib/dna-open-lab-v1-client";

const GENERATION_AT = "2026-08-28T08:00:00Z";
const OBSERVED_AT = "2026-08-28T07:59:00Z";

function candidate(
  input: {
    tokenCount?: number;
    arenaCount?: number;
    arenaStatus?: "complete" | "partial";
  } = {},
): DnaCurrentStateCandidate {
  return {
    generationId: "11111111-1111-4111-8111-111111111111",
    observedAt: GENERATION_AT,
    families: {
      vault: { status: "complete", itemCount: 1 },
      cores: { status: "complete", itemCount: 2 },
      active_races: { status: "complete", itemCount: 0 },
      race_fills: { status: "complete", itemCount: 0 },
      tokens: { status: "complete", itemCount: input.tokenCount ?? 1 },
      splice_arena: {
        status: input.arenaStatus ?? "complete",
        itemCount: input.arenaCount ?? 3,
      },
    },
  };
}

function core(hid: number): DnaSpliceArenaCore {
  return {
    hid,
    name: `Synthetic ${String(hid)}`,
    type: "Pacer",
    gender: hid % 2 === 0 ? "Female" : "Male",
    element: "Fire",
    color: "Red",
    hex_code: "#ff0000",
    fno: 4,
    price_usd: hid / 10,
  };
}

function page(input: {
  page: number;
  hasMore: boolean;
  coreIds: readonly number[];
  observedAt?: string;
}) {
  return adaptDnaSpliceArenaPage({
    mode: "bike",
    observedAt: input.observedAt ?? OBSERVED_AT,
    raw: {
      cores: input.coreIds.map(core),
      has_more: input.hasMore,
      limit: 20,
      page: input.page,
    },
  });
}

function input() {
  return {
    candidate: candidate(),
    tokenPrices: adaptDnaTokenPrices({
      observedAt: OBSERVED_AT,
      raw: {
        ethusd: 3200,
        btcusd: 95_000,
        dezusd: 0.1,
        hlxusd: 0.2,
        bgcusd: 1,
        tpusd: 0.3,
        methusd: 32,
        mbtcusd: 950,
      },
    }),
    arenaModes: ["bike"] as const,
    arenaPages: [
      page({ page: 2, hasMore: false, coreIds: [303] }),
      page({ page: 1, hasMore: true, coreIds: [202, 101] }),
    ],
  };
}

describe("DNA Open Lab Token/Splice generation materialization", () => {
  it("creates deterministic token and complete Arena page/listing rows", () => {
    const result = createDnaTokenSpliceMaterialization(input());

    expect(result).toMatchObject({
      generationId: "11111111-1111-4111-8111-111111111111",
      generationObservedAt: "2026-08-28T08:00:00.000Z",
      arenaModes: ["bike"],
      tokenPrices: {
        observedAt: "2026-08-28T07:59:00.000Z",
        canonical: {
          valuationUse: "current_reference_only",
          usdReferencePriceByAsset: { ETH: 3200 },
        },
      },
    });
    expect(result.arenaPages.map((entry) => entry.page)).toEqual([1, 2]);
    expect(result.arenaListings.map((entry) => entry.sourceCoreId)).toEqual([
      "101",
      "202",
      "303",
    ]);
    expect(result.arenaListings[0]).toMatchObject({
      mode: "bike",
      page: 1,
      canonical: { sourceCoreId: "101", priceUsdSourceValue: 10.1 },
    });
  });

  it("accepts a proven empty mode only with its terminal page", () => {
    const value = input();
    const result = createDnaTokenSpliceMaterialization({
      ...value,
      candidate: candidate({ arenaCount: 0 }),
      arenaPages: [page({ page: 1, hasMore: false, coreIds: [] })],
    });

    expect(result.arenaPages).toHaveLength(1);
    expect(result.arenaListings).toEqual([]);
  });

  it("rejects missing pages, non-terminal crawls and repeated Cores", () => {
    const value = input();
    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        arenaPages: [page({ page: 2, hasMore: false, coreIds: [303] })],
      }),
    ).toThrow("pages must be contiguous from page 1");

    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        candidate: candidate({ arenaCount: 2 }),
        arenaPages: [page({ page: 1, hasMore: true, coreIds: [101, 202] })],
      }),
    ).toThrow("pagination must end at exactly one terminal page");

    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        candidate: candidate({ arenaCount: 2 }),
        arenaPages: [
          page({ page: 1, hasMore: true, coreIds: [101] }),
          page({ page: 2, hasMore: false, coreIds: [101] }),
        ],
      }),
    ).toThrow("cannot repeat a Core across pages");
  });

  it("rejects receipt mismatch, incomplete generations and late evidence", () => {
    const value = input();
    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        candidate: candidate({ tokenCount: 0 }),
      }),
    ).toThrow("Token family receipt must contain exactly one snapshot");

    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        candidate: candidate({ arenaCount: 4 }),
      }),
    ).toThrow("Arena listing count must match");

    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        candidate: candidate({ arenaStatus: "partial" }),
      }),
    ).toThrow("generation is incomplete: splice_arena");

    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        arenaPages: [
          page({
            page: 1,
            hasMore: false,
            coreIds: [101, 202, 303],
            observedAt: "2026-08-28T08:00:01Z",
          }),
        ],
      }),
    ).toThrow("Arena page observation cannot follow its generation");
  });

  it("rejects forged endpoint authority and unexpected Arena modes", () => {
    const value = input();
    const forged = {
      ...value.arenaPages[0],
      endpoint: "splice.pair_info",
    } as DnaOpenLabEvidence<CanonicalSpliceArenaPageSnapshot>;
    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        arenaPages: [value.arenaPages[1]!, forged],
      }),
    ).toThrow("Arena page evidence authority is invalid");

    const car = adaptDnaSpliceArenaPage({
      mode: "car",
      observedAt: OBSERVED_AT,
      raw: { cores: [], has_more: false, limit: 20, page: 1 },
    });
    expect(() =>
      createDnaTokenSpliceMaterialization({
        ...value,
        arenaPages: [...value.arenaPages, car],
      }),
    ).toThrow("Arena page contains an unexpected mode");
  });

  it("keeps pair previews outside the complete current-family payload", () => {
    const result: DnaTokenSpliceMaterialization =
      createDnaTokenSpliceMaterialization(input());
    expect(result).not.toHaveProperty("pairInfo");
    expect(result).not.toHaveProperty("pairValidation");
  });
});
