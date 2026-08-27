import { describe, expect, it } from "vitest";

import {
  compareDnaOpenLabToCsv,
  DnaCsvEquivalenceError,
  type DnaCsvEquivalenceEntity,
  type DnaCsvEquivalenceFieldSpec,
} from "../lib/dna-open-lab-csv-equivalence";

function entity(
  entityType: DnaCsvEquivalenceEntity["entityType"],
  entityKey: string,
  facts: Readonly<Record<string, unknown>>,
): DnaCsvEquivalenceEntity {
  return Object.freeze({ entityType, entityKey, facts: Object.freeze(facts) });
}

function fields(
  input: readonly DnaCsvEquivalenceFieldSpec[],
): readonly DnaCsvEquivalenceFieldSpec[] {
  return Object.freeze(input);
}

describe("DNA Open Lab / CSV equivalence harness", () => {
  it("proves required historical fields only when both sources match", () => {
    const report = compareDnaOpenLabToCsv({
      api: entity("race", "race:1001", {
        rid: 1001,
        race: {
          mode: "bike",
          distance: 800,
          entrants: [101, 202, 303],
        },
      }),
      csv: entity("race", "race:1001", {
        event_id: 1001,
        mode: "bike",
        distance: 800,
        core_ids: [101, 202, 303],
      }),
      fields: fields([
        {
          canonicalField: "race.identity",
          apiPath: ["rid"],
          csvPath: ["event_id"],
          requiredForApiReplacement: true,
        },
        {
          canonicalField: "race.mode",
          apiPath: ["race", "mode"],
          csvPath: ["mode"],
          requiredForApiReplacement: true,
        },
        {
          canonicalField: "race.distance",
          apiPath: ["race", "distance"],
          csvPath: ["distance"],
          requiredForApiReplacement: true,
        },
        {
          canonicalField: "race.entrants",
          apiPath: ["race", "entrants"],
          csvPath: ["core_ids"],
          requiredForApiReplacement: true,
        },
      ]),
    });

    expect(report.apiReplacementEvidenceReady).toBe(true);
    expect(report.summary).toEqual({
      comparedFieldCount: 4,
      matchedFieldCount: 4,
      mismatchedFieldCount: 0,
      apiOnlyFieldCount: 0,
      csvOnlyFieldCount: 0,
      unverifiedFieldCount: 0,
      requiredFieldCount: 4,
      requiredMatchedFieldCount: 4,
    });
    expect(
      report.fields.every((field) => field.implication === "equivalent_fact"),
    ).toBe(true);
  });

  it("leaves conflicts unresolved instead of choosing API or CSV authority", () => {
    const report = compareDnaOpenLabToCsv({
      api: entity("race", "race:1002", { distance: 1200 }),
      csv: entity("race", "race:1002", { distance: 1000 }),
      fields: fields([
        {
          canonicalField: "race.distance",
          apiPath: ["distance"],
          csvPath: ["distance"],
          requiredForApiReplacement: true,
        },
      ]),
    });

    expect(report.fields[0]).toMatchObject({
      status: "mismatch",
      implication: "requires_source_authority_decision",
    });
    expect(report.apiReplacementEvidenceReady).toBe(false);
  });

  it("classifies API supplements and CSV fallback candidates without inferring semantics", () => {
    const report = compareDnaOpenLabToCsv({
      api: entity("core", "core:42", {
        identity: { hid: 42, name: "Synthetic Core" },
        api_context: { power: 0.73 },
      }),
      csv: entity("core", "core:42", {
        identity: { hid: 42, name: "Synthetic Core" },
        local_strategy: { maiden_eligible: true },
      }),
      fields: fields([
        {
          canonicalField: "core.identity",
          apiPath: ["identity"],
          csvPath: ["identity"],
          requiredForApiReplacement: true,
        },
        {
          canonicalField: "core.current_context",
          apiPath: ["api_context"],
          csvPath: ["api_context"],
        },
        {
          canonicalField: "core.local_strategy",
          apiPath: ["local_strategy"],
          csvPath: ["local_strategy"],
        },
      ]),
    });

    expect(
      report.fields.map(({ status, implication }) => ({ status, implication })),
    ).toEqual([
      { status: "match", implication: "equivalent_fact" },
      { status: "api_only", implication: "api_supplement_candidate" },
      { status: "csv_only", implication: "csv_fallback_candidate" },
    ]);
    expect(report.apiReplacementEvidenceReady).toBe(true);
  });

  it("distinguishes an observed null from a missing field", () => {
    const report = compareDnaOpenLabToCsv({
      api: entity("arena", "arena:77", { price: null }),
      csv: entity("arena", "arena:77", {}),
      fields: fields([
        {
          canonicalField: "arena.price",
          apiPath: ["price"],
          csvPath: ["price"],
        },
      ]),
    });

    expect(report.fields[0]).toMatchObject({
      apiPresent: true,
      csvPresent: false,
      status: "api_only",
    });
  });

  it("can compare unordered scalar multisets only when the caller explicitly selects it", () => {
    const ordered = compareDnaOpenLabToCsv({
      api: entity("race", "race:1003", { entrants: [101, 202, 303] }),
      csv: entity("race", "race:1003", { entrants: [303, 101, 202] }),
      fields: fields([
        {
          canonicalField: "race.entrants",
          apiPath: ["entrants"],
          csvPath: ["entrants"],
        },
      ]),
    });
    const unordered = compareDnaOpenLabToCsv({
      api: entity("race", "race:1003", { entrants: [101, 202, 303] }),
      csv: entity("race", "race:1003", { entrants: [303, 101, 202] }),
      fields: fields([
        {
          canonicalField: "race.entrants",
          apiPath: ["entrants"],
          csvPath: ["entrants"],
          comparison: "unordered_scalar_multiset",
        },
      ]),
    });

    expect(ordered.fields[0]?.status).toBe("mismatch");
    expect(unordered.fields[0]?.status).toBe("match");
  });

  it("preserves duplicate counts in unordered scalar comparison", () => {
    const report = compareDnaOpenLabToCsv({
      api: entity("race", "race:1004", { entrants: [101, 101, 202] }),
      csv: entity("race", "race:1004", { entrants: [101, 202] }),
      fields: fields([
        {
          canonicalField: "race.entrants",
          apiPath: ["entrants"],
          csvPath: ["entrants"],
          comparison: "unordered_scalar_multiset",
        },
      ]),
    });

    expect(report.fields[0]?.status).toBe("mismatch");
  });

  it("does not claim replacement readiness when required comparison evidence is absent", () => {
    const report = compareDnaOpenLabToCsv({
      api: entity("race", "race:1005", {}),
      csv: entity("race", "race:1005", {}),
      fields: fields([
        {
          canonicalField: "race.finish_positions",
          apiPath: ["finish_positions"],
          csvPath: ["finish_positions"],
          requiredForApiReplacement: true,
        },
      ]),
    });

    expect(report.fields[0]).toMatchObject({
      status: "both_missing",
      implication: "unverified",
    });
    expect(report.apiReplacementEvidenceReady).toBe(false);
  });

  it("fails closed for mismatched identities, duplicate fields and non-JSON values", () => {
    expect(() =>
      compareDnaOpenLabToCsv({
        api: entity("race", "race:1", { rid: 1 }),
        csv: entity("race", "race:2", { event_id: 2 }),
        fields: fields([
          {
            canonicalField: "race.identity",
            apiPath: ["rid"],
            csvPath: ["event_id"],
          },
        ]),
      }),
    ).toThrow(DnaCsvEquivalenceError);

    expect(() =>
      compareDnaOpenLabToCsv({
        api: entity("core", "core:1", { hid: 1 }),
        csv: entity("core", "core:1", { hid: 1 }),
        fields: fields([
          {
            canonicalField: "core.identity",
            apiPath: ["hid"],
            csvPath: ["hid"],
          },
          {
            canonicalField: "core.identity",
            apiPath: ["hid"],
            csvPath: ["hid"],
          },
        ]),
      }),
    ).toThrow("duplicate canonical field core.identity");

    expect(() =>
      compareDnaOpenLabToCsv({
        api: entity("core", "core:1", { value: Number.POSITIVE_INFINITY }),
        csv: entity("core", "core:1", { value: 1 }),
        fields: fields([
          {
            canonicalField: "core.value",
            apiPath: ["value"],
            csvPath: ["value"],
          },
        ]),
      }),
    ).toThrow("non-finite number");
  });
});
