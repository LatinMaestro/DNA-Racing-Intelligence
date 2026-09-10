import { describe, expect, it } from "vitest";

import {
  adaptDnaActiveRace,
  adaptDnaCoreInfo,
  adaptDnaRaceDocument,
  adaptDnaRaceFill,
  adaptDnaVaultCore,
  dnaOpenLabRawEvidenceSha256,
  DnaOpenLabAdapterError,
  DnaRaceDocumentAdaptationProcessingError,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaActiveRace,
  DnaCoreInfo,
  DnaRaceDocument,
  DnaRaceFill,
  DnaVaultCore,
} from "@/lib/dna-open-lab-v1-client";

const OBSERVED_AT = "2026-08-27T01:50:00.000Z";

const coreInfo: DnaCoreInfo = {
  hid: 42,
  name: "Synthetic Core",
  type: "freak",
  element: "water",
  color: "blue",
  hex_code: "#0000ff",
  fno: 12,
  gender: "female",
  vault: "0xsynthetic",
  future_optional_field: { retained_in_raw_evidence: true },
};

const vaultCore: DnaVaultCore = {
  hid: 43,
  name: "Synthetic Vault Core",
  type: "x-class",
  element: "fire",
  gender: "male",
  fno: 7,
};

const activeRace: DnaActiveRace = {
  rid: "race-100",
  status: "open",
  race_name: "Synthetic Sprint",
  format: "normal",
  class: "open",
  cb: 1000,
  rgate: 8,
  hs_in: 3,
  fee_fixed: { DEZ: 0.25, ETH: 0.0001 },
  feeusd: 2.5,
  paytoken: "DEZ",
  start_time: "2026-08-27T02:00:00Z",
  end_time: null,
  version: 3,
  rvmode: "bike",
  future_optional_field: "ignored-by-canonical-model",
};

const raceDocument: DnaRaceDocument = {
  rid: 101,
  status: "finished",
  race_name: "Synthetic Hydrated Race",
  rvmode: "bike",
  format: "normal",
  class: 2,
  rgate: 4,
  hs_in: 3,
  hids: [42, 43, 44],
  fee_fixed: { DEZ: 0.5 },
  feeusd: 4,
  paytoken: "DEZ",
  start_time: null,
  eventtags: ["synthetic-tag"],
  payout: "winner_take_all",
  prize: 5,
  prizeusd: 6.25,
  track: "synthetic-track",
  yellowstars: [42],
  bluestars: [43],
  future_nested_result: { intentionally_not_mapped_before_p3: true },
};

const raceFill: DnaRaceFill = {
  rid: "race-102",
  status: "filling",
  rgate: 8,
  hs_in: 3,
  hids: [42, 43, 44],
  entry_txns_confirmed: {
    "43": false,
    "42": true,
    "44": true,
  },
  future_optional_field: { retained_in_raw_evidence: true },
};

describe("DNA Open Lab v1 canonical adapters", () => {
  it("maps Core info into the existing canonical Core Details model with API provenance", () => {
    const adapted = adaptDnaCoreInfo({
      raw: coreInfo,
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      source: "dna_open_lab",
      sourceVersion: "v1",
      scope: "cores",
      endpoint: "cores.info",
      entityKey: "core:42",
      observedAt: OBSERVED_AT,
      canonical: {
        sourceType: "core_details",
        sourceCoreId: "42",
        displayName: "Synthetic Core",
        coreClass: "Freak",
        element: "Water",
        fNumber: 12,
        sex: "female",
        colorSourceValue: "blue",
        fatherSourceCoreId: null,
        motherSourceCoreId: null,
      },
    });
    expect(adapted.rawEvidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(adapted.canonical)).not.toContain(
      "future_optional_field",
    );
  });

  it("maps vault cores into the same Core Details model without inventing missing lineage or colour", () => {
    const adapted = adaptDnaVaultCore({
      raw: vaultCore,
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      scope: "vault",
      endpoint: "vault.cores_full",
      entityKey: "core:43",
      canonical: {
        sourceType: "core_details",
        sourceCoreId: "43",
        coreClass: "X-Class",
        element: "Fire",
        sex: "male",
        colorSourceValue: null,
        fatherSourceCoreId: null,
        fatherNameSourceValue: null,
        motherSourceCoreId: null,
        motherNameSourceValue: null,
      },
    });
  });

  it("maps active races into API-neutral current-race fields while retaining only a raw evidence hash", () => {
    const adapted = adaptDnaActiveRace({
      raw: activeRace,
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      source: "dna_open_lab",
      scope: "races",
      endpoint: "races.active",
      entityKey: "race:race-100",
      canonical: {
        sourceType: "active_race_snapshot",
        sourceRaceId: "race-100",
        status: "open",
        displayName: "Synthetic Sprint",
        mode: "bike",
        format: "normal",
        raceClassSourceValue: "open",
        fixedFeesByAsset: { DEZ: 0.25, ETH: 0.0001 },
        entryFeeUsd: 2.5,
        paymentAsset: "DEZ",
        startAt: "2026-08-27T02:00:00.000Z",
        endAt: null,
      },
    });
    expect(adapted.canonical).not.toHaveProperty("rvmode");
    expect(adapted.canonical).not.toHaveProperty("feeusd");
    expect(adapted.canonical).not.toHaveProperty("future_optional_field");
  });

  it("accepts the connected active-race numeric class, null start, and omitted end contract", () => {
    const { end_time, ...withoutEndTime } = activeRace;
    expect(end_time).toBeNull();
    const adapted = adaptDnaActiveRace({
      raw: {
        ...withoutEndTime,
        class: 3,
        start_time: null,
      },
      observedAt: OBSERVED_AT,
    });

    expect(adapted.canonical).toMatchObject({
      raceClassSourceValue: 3,
      startAt: null,
      endAt: null,
    });
  });

  it("retains an active race when the API omits its optional start time", () => {
    const { start_time, ...withoutStartTime } = activeRace;
    expect(start_time).toBe("2026-08-27T02:00:00Z");

    const adapted = adaptDnaActiveRace({
      raw: withoutStartTime,
      observedAt: OBSERVED_AT,
    });

    expect(adapted.canonical.startAt).toBeNull();
  });

  it("maps only connected race-document metadata without inventing results, distance, or star semantics", () => {
    const finished = adaptDnaRaceDocument({
      raw: raceDocument,
      observedAt: OBSERVED_AT,
      endpoint: "races.finished",
    });
    const hydrated = adaptDnaRaceDocument({
      raw: raceDocument,
      observedAt: OBSERVED_AT,
      endpoint: "races.docs",
    });
    const recent = adaptDnaRaceDocument({
      raw: raceDocument,
      observedAt: OBSERVED_AT,
      endpoint: "vault.recent_races",
    });

    expect(finished).toMatchObject({
      scope: "races",
      endpoint: "races.finished",
      entityKey: "race:101",
      canonical: {
        sourceType: "race_document",
        sourceRaceId: "101",
        status: "finished",
        displayName: "Synthetic Hydrated Race",
        mode: "bike",
        format: "normal",
        raceClassSourceValue: 2,
        gateCount: 4,
        filledGateCount: 3,
        entrantCoreIds: ["42", "43", "44"],
        fixedFeesByAsset: { DEZ: 0.5 },
        entryFeeUsd: 4,
        paymentAsset: "DEZ",
        startAt: null,
        eventTagsSourceValues: ["synthetic-tag"],
        payoutSourceValue: "winner_take_all",
        prizeSourceValue: 5,
        prizeUsdSourceValue: 6.25,
        trackSourceValue: "synthetic-track",
        yellowStarSourceCoreIds: ["42"],
        blueStarSourceCoreIds: ["43"],
      },
    });
    expect(hydrated).toMatchObject({
      scope: "races",
      endpoint: "races.docs",
    });
    expect(recent).toMatchObject({
      scope: "vault",
      endpoint: "vault.recent_races",
    });
    expect(finished.canonical).not.toHaveProperty("distance");
    expect(finished.canonical).not.toHaveProperty("finishPosition");
    expect(finished.canonical).not.toHaveProperty("elapsedTime");
    expect(finished.canonical).not.toHaveProperty("goldStarCoreIds");
    expect(finished.canonical).not.toHaveProperty("future_nested_result");
    expect(finished.rawEvidenceSha256).toBe(hydrated.rawEvidenceSha256);
  });

  it.each([
    {
      name: "identity",
      raw: { rid: 0 },
      diagnostic: "race_document_adaptation_identity_unavailable",
    },
    {
      name: "status",
      raw: { rid: 1, status: "" },
      diagnostic: "race_document_adaptation_status_unavailable",
    },
    {
      name: "name",
      raw: { rid: 1, race_name: "" },
      diagnostic: "race_document_adaptation_name_unavailable",
    },
    {
      name: "format",
      raw: { rid: 1, format: "" },
      diagnostic: "race_document_adaptation_format_unavailable",
    },
    {
      name: "class",
      raw: { rid: 1, class: "" },
      diagnostic: "race_document_adaptation_class_unavailable",
    },
    {
      name: "gate count",
      raw: { rid: 1, rgate: 0 },
      diagnostic: "race_document_adaptation_gate_count_unavailable",
    },
    {
      name: "filled gate count",
      raw: { rid: 1, hs_in: -1 },
      diagnostic: "race_document_adaptation_filled_gate_count_unavailable",
    },
    {
      name: "entry fee USD",
      raw: { rid: 1, feeusd: -1 },
      diagnostic: "race_document_adaptation_entry_fee_usd_unavailable",
    },
    {
      name: "payment asset",
      raw: { rid: 1, paytoken: "" },
      diagnostic: "race_document_adaptation_payment_asset_unavailable",
    },
    {
      name: "payout",
      raw: { rid: 1, payout: "" },
      diagnostic: "race_document_adaptation_payout_unavailable",
    },
    {
      name: "non-numeric prize",
      raw: { rid: 1, prize: "unknown" },
      diagnostic: "race_document_adaptation_prize_non_numeric_unavailable",
    },
    {
      name: "prize value",
      raw: { rid: 1, prize: -1 },
      diagnostic: "race_document_adaptation_prize_value_unavailable",
    },
    {
      name: "prize USD",
      raw: { rid: 1, prizeusd: -1 },
      diagnostic: "race_document_adaptation_prize_usd_unavailable",
    },
    {
      name: "schedule",
      raw: { rid: 1, start_time: "invalid" },
      diagnostic: "race_document_adaptation_schedule_unavailable",
    },
    {
      name: "evidence",
      raw: { rid: 1 },
      observedAt: "invalid",
      diagnostic: "race_document_adaptation_evidence_unavailable",
    },
  ] as const)(
    "classifies $name Race document adaptation without exposing field detail",
    ({ raw, observedAt, diagnostic }) => {
      const error = (() => {
        try {
          adaptDnaRaceDocument({
            raw: raw as DnaRaceDocument,
            observedAt: observedAt ?? OBSERVED_AT,
            endpoint: "races.docs",
          });
        } catch (caught) {
          return caught;
        }
        return null;
      })();

      expect(error).toBeInstanceOf(DnaRaceDocumentAdaptationProcessingError);
      expect(error).toMatchObject({
        diagnostic,
        message: "DNA Race document canonical adaptation is unavailable",
      });
      expect(String(error)).not.toContain("race.");
    },
  );

  it.each([
    { name: "collection shape", hids: null },
    { name: "entry runtime type", hids: ["1"] },
    { name: "entry numeric value", hids: [0] },
  ])(
    "quarantines unsupported entrant Core ID $name without blocking the Race",
    ({ hids }) => {
      const raw = { rid: 1, hids } as DnaRaceDocument;
      const evidence = adaptDnaRaceDocument({
        raw,
        observedAt: OBSERVED_AT,
        endpoint: "races.docs",
      });

      expect(evidence.canonical).toMatchObject({
        sourceRaceId: "1",
        entrantCoreIdsEvidenceStatus: "unsupported_source_value",
      });
      expect(evidence.canonical).not.toHaveProperty("entrantCoreIds");
      expect(evidence.rawEvidenceSha256).toBe(dnaOpenLabRawEvidenceSha256(raw));
    },
  );

  it.each([
    { name: "track value", results: { track: "" } },
    { name: "yellow-star collection", results: { yellowstars: null } },
    { name: "blue-star Core ID", results: { bluestars: [0] } },
  ])(
    "quarantines unsupported Race $name without blocking the Race",
    ({ results }) => {
      const raw = { rid: 1, ...results } as DnaRaceDocument;
      const evidence = adaptDnaRaceDocument({
        raw,
        observedAt: OBSERVED_AT,
        endpoint: "races.docs",
      });

      expect(evidence.canonical).toMatchObject({
        sourceRaceId: "1",
        resultsEvidenceStatus: "unsupported_source_value",
      });
      expect(evidence.canonical).not.toHaveProperty("trackSourceValue");
      expect(evidence.canonical).not.toHaveProperty("yellowStarSourceCoreIds");
      expect(evidence.canonical).not.toHaveProperty("blueStarSourceCoreIds");
      expect(evidence.rawEvidenceSha256).toBe(dnaOpenLabRawEvidenceSha256(raw));
    },
  );

  it.each([null, "  ", "unsupported"])(
    "preserves unsupported Race mode evidence without inventing canonical meaning",
    (rvmode) => {
      const evidence = adaptDnaRaceDocument({
        raw: { rid: 1, rvmode: rvmode as never },
        observedAt: OBSERVED_AT,
        endpoint: "races.docs",
      });

      expect(evidence.canonical).toMatchObject({
        sourceRaceId: "1",
        modeEvidenceStatus: "unsupported_source_value",
      });
      expect(evidence.canonical).not.toHaveProperty("mode");
    },
  );

  it.each([null, { DEZ: -1 }, { DEZ: "1" }, { " ": 1 }])(
    "quarantines unsupported fixed-fee evidence without blocking the Race",
    (feeFixed) => {
      const raw = { rid: 1, fee_fixed: feeFixed } as DnaRaceDocument;
      const evidence = adaptDnaRaceDocument({
        raw,
        observedAt: OBSERVED_AT,
        endpoint: "races.docs",
      });

      expect(evidence.canonical).toMatchObject({
        sourceRaceId: "1",
        fixedFeesEvidenceStatus: "unsupported_source_value",
      });
      expect(evidence.canonical).not.toHaveProperty("fixedFeesByAsset");
      expect(evidence.rawEvidenceSha256).toBe(dnaOpenLabRawEvidenceSha256(raw));
    },
  );

  it("preserves an explicit null Race prize as absent evidence without inferring zero", () => {
    const raw = { rid: 1, prize: null as never };
    const evidence = adaptDnaRaceDocument({
      raw,
      observedAt: OBSERVED_AT,
      endpoint: "races.docs",
    });

    expect(evidence.canonical).toMatchObject({
      sourceRaceId: "1",
      prizeEvidenceStatus: "explicitly_absent",
    });
    expect(evidence.canonical).not.toHaveProperty("prizeSourceValue");
    expect(evidence.rawEvidenceSha256).toBe(dnaOpenLabRawEvidenceSha256(raw));
  });

  it("preserves an explicit null Race USD prize as absent evidence without inferring zero", () => {
    const raw = { rid: 1, prizeusd: null as never };
    const evidence = adaptDnaRaceDocument({
      raw,
      observedAt: OBSERVED_AT,
      endpoint: "races.docs",
    });

    expect(evidence.canonical).toMatchObject({
      sourceRaceId: "1",
      prizeUsdEvidenceStatus: "explicitly_absent",
    });
    expect(evidence.canonical).not.toHaveProperty("prizeUsdSourceValue");
    expect(evidence.rawEvidenceSha256).toBe(dnaOpenLabRawEvidenceSha256(raw));
  });

  it("maps race fills into API-neutral gate and entrant state with deterministic confirmation-key ordering", () => {
    const adapted = adaptDnaRaceFill({
      raw: raceFill,
      observedAt: OBSERVED_AT,
    });

    expect(adapted).toMatchObject({
      source: "dna_open_lab",
      scope: "races",
      endpoint: "races.fills",
      entityKey: "race:race-102",
      canonical: {
        sourceType: "race_fill_snapshot",
        sourceRaceId: "race-102",
        status: "filling",
        gateCount: 8,
        filledGateCount: 3,
        entrantCoreIds: ["42", "43", "44"],
        entryConfirmationsBySourceKey: {
          "42": true,
          "43": false,
          "44": true,
        },
      },
    });
    expect(adapted.canonical).not.toHaveProperty("hids");
    expect(adapted.canonical).not.toHaveProperty("entry_txns_confirmed");
    expect(adapted.canonical).not.toHaveProperty("future_optional_field");
  });

  it("fails closed on internally inconsistent race-fill counts", () => {
    expect(() =>
      adaptDnaRaceFill({
        raw: { ...raceFill, hs_in: 4 },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError(
      "raceFill entrant count must equal raceFill.filledGateCount",
    );

    expect(() =>
      adaptDnaRaceFill({
        raw: { ...raceFill, rgate: 2 },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("raceFill.filledGateCount cannot exceed raceFill.gateCount");
  });

  it("hashes JSON evidence deterministically regardless of object key order", () => {
    const left = dnaOpenLabRawEvidenceSha256({
      z: 3,
      nested: { b: 2, a: 1 },
      list: [{ y: 2, x: 1 }],
    });
    const right = dnaOpenLabRawEvidenceSha256({
      list: [{ x: 1, y: 2 }],
      nested: { a: 1, b: 2 },
      z: 3,
    });

    expect(left).toBe(right);
    expect(
      dnaOpenLabRawEvidenceSha256({
        z: 3,
        nested: { b: 2, a: 1 },
        list: [{ y: 2, x: 99 }],
      }),
    ).not.toBe(left);
  });

  it("fails closed instead of leaking unsupported source values into canonical analytics", () => {
    expect(() =>
      adaptDnaCoreInfo({
        raw: { ...coreInfo, element: "future-element" },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError(DnaOpenLabAdapterError);

    expect(() =>
      adaptDnaActiveRace({
        raw: { ...activeRace, rvmode: "spaceship" as never },
        observedAt: OBSERVED_AT,
      }),
    ).toThrowError("race.mode is unsupported");
  });

  it("requires deterministic timezone-qualified observation timestamps", () => {
    expect(() =>
      adaptDnaCoreInfo({ raw: coreInfo, observedAt: "2026-08-27 11:50" }),
    ).toThrowError("observedAt must be a timezone-qualified ISO timestamp");
  });

  it("rejects non-JSON raw evidence values instead of producing ambiguous hashes", () => {
    expect(() =>
      dnaOpenLabRawEvidenceSha256({ value: Number.POSITIVE_INFINITY }),
    ).toThrowError("raw API evidence contains a non-finite number");
    expect(() =>
      dnaOpenLabRawEvidenceSha256({ value: undefined }),
    ).toThrowError("raw API evidence contains a non-JSON value");
  });
});
