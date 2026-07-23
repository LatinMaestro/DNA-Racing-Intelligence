import { describe, expect, it } from "vitest";
import {
  adaptSourceRow,
  redactSourceRowSummary,
} from "@/domain/source-adapters";
import { stageSourceHeader } from "@/domain/source-schema";

const utf8 = (value: string) => new TextEncoder().encode(value);

function schema(header: string) {
  return stageSourceHeader({ headerBytes: utf8(`${header}\n`) });
}

describe("Phase 1 synthetic source adapters", () => {
  it("normalizes owner-confirmed Race Merge economics and restrictions", () => {
    const staged = schema(
      "event_id,event_datetime,rstart_time,rmode,rclass,rcb,token_id,name,gate,rgate_count,gold_star,blue_star,pos,time,rformat,rpayout,rfee,prize,toke_curr,r_tags",
    );
    const row = adaptSourceRow(staged, [
      "synthetic-event",
      "1784721600",
      "2026-07-22T12:00:00.000Z",
      "Horse",
      "ignored-legacy-class",
      "1600",
      "synthetic-core",
      "Synthetic Core",
      "2",
      "8",
      "TRUE",
      "False",
      "1",
      "91.234",
      "normal",
      "synthetic-payout-label",
      "0.01",
      "0.02",
      "DEZ",
      "Water, ME",
    ]);

    expect(row).toMatchObject({ status: "ready", sourceType: "race_merge" });
    expect(row.record).toMatchObject({
      sourceType: "race_merge",
      mode: "horse",
      distance: 1600,
      gateCount: 8,
      goldStar: true,
      blueStar: false,
      goldStarEligible: true,
      starDataStatus: "complete",
      economicDataStatus: "ready",
      raceAsset: "DEZ",
      entryFeeAmount: "0.01",
      grossPayoutAmount: "0.02",
      payoutMechanismSourceValue: "synthetic-payout-label",
      raceTagsSourceValue: "Water, ME",
    });
  });

  it("keeps a valid race row while quarantining malformed economics", () => {
    const staged = schema(
      "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time,rpayout,rfee,prize,toke_curr,r_tags",
    );
    const row = adaptSourceRow(staged, [
      "event-economic-review",
      "2026-07-22T12:00:00.000Z",
      "bike",
      "1000",
      "core-economic-review",
      "4",
      "false",
      "false",
      "2",
      "50.1",
      "top2",
      "-1",
      "2",
      "DEZ",
      "F1-4",
    ]);

    expect(row.status).toBe("ready");
    expect(row.record).toMatchObject({
      economicDataStatus: "invalid",
      payoutMechanismSourceValue: "top2",
      raceTagsSourceValue: "F1-4",
    });
    expect(row.issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_ECONOMIC_DECIMAL",
        severity: "warning",
      }),
    );
  });

  it("retains an ineligible source Gold assignment with a warning", () => {
    const staged = schema(
      "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time",
    );
    const row = adaptSourceRow(staged, [
      "event-3-gates",
      "2026-07-22T12:00:00.000Z",
      "bike",
      "1000",
      "core-1",
      "3",
      "true",
      "false",
      "1",
      "50.1",
    ]);

    expect(row.status).toBe("ready");
    expect(row.record).toMatchObject({
      goldStar: true,
      goldStarEligible: false,
    });
    expect(row.issues).toContainEqual(
      expect.objectContaining({ code: "GOLD_INELIGIBLE_ASSIGNMENT" }),
    );
  });

  it("distinguishes invalid and missing star values from false", () => {
    const staged = schema(
      "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time",
    );
    const invalid = adaptSourceRow(staged, [
      "event-invalid-star",
      "2026-07-22T12:00:00.000Z",
      "car",
      "1200",
      "core-2",
      "8",
      "not-a-boolean",
      "",
      "2",
      "61.5",
    ]);

    expect(invalid.status).toBe("ready");
    expect(invalid.record).toMatchObject({
      goldStar: null,
      blueStar: null,
      starDataStatus: "invalid",
    });
    expect(invalid.issues[0]?.severity).toBe("warning");
  });

  it("quarantines a race row with an invalid required value", () => {
    const staged = schema(
      "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time",
    );
    const row = adaptSourceRow(staged, [
      "event-invalid",
      "not-a-time",
      "car",
      "1200",
      "core-3",
      "8",
      "false",
      "false",
      "2",
      "61.5",
    ]);
    expect(row.status).toBe("quarantined");
    expect(row.record).toBeNull();
    expect(row.issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_TIMESTAMP" }),
    );
  });

  it("normalizes legacy Core Details without treating it as bike-only", () => {
    const staged = schema(
      "bikeid,core_name,core_type,gender,f_no,element,color,father_name,father_id,mother_name,mother_id",
    );
    const row = adaptSourceRow(staged, [
      "core-4",
      "Synthetic Child",
      "xclass",
      "Female",
      "F12",
      "water",
      "synthetic-color",
      "Synthetic Father",
      "core-father",
      "Synthetic Mother",
      "core-mother",
    ]);
    expect(row.record).toMatchObject({
      sourceType: "core_details",
      sourceCoreId: "core-4",
      coreClass: "X-Class",
      sex: "female",
      fNumber: 12,
      element: "Water",
    });
  });

  it("keeps name-only Current Vault identity in review", () => {
    const staged = schema("core_name,f_no,core_type,element,gender,me");
    const row = adaptSourceRow(staged, [
      "Synthetic Owned Core",
      "F3",
      "morphed",
      "fire",
      "male",
      "TRUE",
    ]);
    expect(row.record).toMatchObject({
      sourceType: "current_vault",
      sourceCoreId: null,
      maidenEligible: true,
      maidenDataStatus: "valid",
      identityResolutionStatus: "review_required",
    });
  });

  it("rejects ambiguous timestamps and zero elapsed times", () => {
    const staged = schema(
      "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time",
    );
    const ambiguous = adaptSourceRow(staged, [
      "event-ambiguous-time",
      "07/22/2026 12:00",
      "bike",
      "1000",
      "core-6",
      "8",
      "false",
      "false",
      "1",
      "0",
    ]);
    expect(ambiguous.status).toBe("quarantined");
    expect(ambiguous.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["INVALID_TIMESTAMP", "INVALID_DECIMAL"]),
    );
  });

  it("keeps Arena prices exact and cannot create breeding income", () => {
    const staged = schema("token_id,price_usd");
    const row = adaptSourceRow(staged, ["core-5", "125.00"]);
    expect(row.record).toEqual({
      sourceType: "current_arena",
      sourceCoreId: "core-5",
      priceUsdSourceValue: "125.00",
      createsEconomicTransaction: false,
    });
  });

  it("quarantines malformed Arena prices", () => {
    const staged = schema("token_id,price_usd");
    const row = adaptSourceRow(staged, ["core-5", "12 dollars"]);
    expect(row.status).toBe("quarantined");
    expect(row.issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_DECIMAL" }),
    );
  });

  it("does not expose raw values or headers in routine summaries", () => {
    const privateMarker = "private-marker";
    const staged = schema("token_id,price_usd");
    const row = adaptSourceRow(staged, [privateMarker, "25"]);
    const summary = JSON.stringify(redactSourceRowSummary(row));
    expect(summary).not.toContain(privateMarker);
    expect(summary).not.toContain("token_id");
    expect(redactSourceRowSummary(row)).toMatchObject({
      status: "ready",
      sourceType: "current_arena",
      sourceColumnCount: 2,
      issueCodes: [],
    });
  });
});
