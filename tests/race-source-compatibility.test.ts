import { describe, expect, it } from "vitest";
import {
  multiplyExactDecimals,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";
import { raceEntryNaturalKey } from "@/domain/import-contract";
import {
  deriveRaceEconomicTransactions,
  validateRaceEconomics,
} from "@/domain/race-economics";

describe("real-source race economic compatibility", () => {
  it("normalizes scientific notation without binary floating point", () => {
    expect(normalizeExactDecimal("1e-7")).toBe("0.0000001");
    expect(normalizeExactDecimal("1.25E+2")).toBe("125");
    expect(normalizeExactDecimal("-2.50e-3")).toBe("-0.0025");
    expect(multiplyExactDecimals("1e-7", "2500")).toBe("0.00025");
  });

  it("derives exact ETH economics encoded in scientific notation", () => {
    const economics = validateRaceEconomics({
      feeSourceValue: "1e-7",
      prizeSourceValue: "2.5E-6",
      assetSourceValue: "eth",
    });

    expect(economics).toMatchObject({
      status: "ready",
      asset: "ETH",
      entryFee: "0.0000001",
      grossPayout: "0.0000025",
      issueCodes: [],
    });
    expect(
      deriveRaceEconomicTransactions(
        raceEntryNaturalKey("scientific-event", "synthetic-core"),
        economics,
      ).map(({ signedAmount }) => signedAmount),
    ).toEqual(["-0.0000001", "0.0000025"]);
  });

  it("treats historical BGC races as performance-only free races", () => {
    const economics = validateRaceEconomics({
      feeSourceValue: "12.5",
      prizeSourceValue: "99",
      assetSourceValue: "bgc",
      payoutMechanismSourceValue: "synthetic-format",
    });

    expect(economics).toMatchObject({
      status: "historical_non_economic",
      asset: null,
      entryFee: "0",
      grossPayout: "0",
      feeSourceValue: "12.5",
      prizeSourceValue: "99",
      issueCodes: [],
    });
    expect(
      deriveRaceEconomicTransactions(
        raceEntryNaturalKey("bgc-event", "synthetic-core"),
        economics,
      ),
    ).toEqual([]);
  });

  it("does not turn ignored BGC source amounts into a review item", () => {
    expect(
      validateRaceEconomics({
        feeSourceValue: "",
        prizeSourceValue: "legacy-value-not-used-economically",
        assetSourceValue: "BGC",
      }),
    ).toMatchObject({
      status: "historical_non_economic",
      entryFee: "0",
      grossPayout: "0",
      issueCodes: [],
    });
  });

  it("continues to quarantine genuinely unsupported race assets", () => {
    expect(
      validateRaceEconomics({
        feeSourceValue: "1",
        prizeSourceValue: "2",
        assetSourceValue: "SOL",
      }),
    ).toMatchObject({
      status: "unsupported_asset",
      issueCodes: ["UNSUPPORTED_RACE_ASSET"],
    });
  });

  it("rejects unsafe exponent ranges and non-decimal forms", () => {
    expect(() => normalizeExactDecimal("1e10001")).toThrow(RangeError);
    expect(() => normalizeExactDecimal("0x10")).toThrow(TypeError);
    expect(() => normalizeExactDecimal("001e-2")).toThrow(TypeError);
  });
});
