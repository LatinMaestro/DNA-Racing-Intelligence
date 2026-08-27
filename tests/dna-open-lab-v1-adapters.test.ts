import { describe, expect, it } from "vitest";

import {
  adaptDnaActiveRace,
  adaptDnaCoreInfo,
  adaptDnaVaultCore,
  dnaOpenLabRawEvidenceSha256,
  DnaOpenLabAdapterError,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaActiveRace,
  DnaCoreInfo,
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
        raceClass: "open",
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
