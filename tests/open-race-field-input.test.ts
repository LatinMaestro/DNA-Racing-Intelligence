import { describe, expect, it } from "vitest";

import {
  validateOpenRaceField,
  type OpenRaceFieldInput,
} from "../domain/open-race-field-input";

function input(
  overrides: Partial<OpenRaceFieldInput> = {},
): OpenRaceFieldInput {
  return {
    requestId: "open-race-1",
    capturedAt: "2026-07-23T10:00:00Z",
    dataCurrentThrough: "2026-07-21T00:00:00Z",
    lastImported: "2026-07-22T00:00:00Z",
    freshness: "current",
    mode: "car",
    distanceMeters: 1600,
    gateCount: 6,
    availableGates: 2,
    raceFormat: "standard",
    entryFee: { amount: "0.0100", asset: "DEZ" },
    opponents: [
      { coreId: "opponent-1", identityStatus: "confirmed" },
      { coreId: "opponent-2", identityStatus: "confirmed" },
      { coreId: "opponent-3", identityStatus: "confirmed" },
      { coreId: "opponent-4", identityStatus: "confirmed" },
    ],
    restrictions: [
      {
        restrictionId: "class-rule",
        kind: "class",
        value: "Morphed,Freak",
        evidenceStatus: "confirmed",
      },
    ],
    ...overrides,
  };
}

describe("Open Race field input", () => {
  it("accepts a complete manually entered forming field", () => {
    const result = validateOpenRaceField(input());
    expect(result).toMatchObject({
      status: "ready_for_provisional_selection",
      fieldStage: "forming",
      currentRaceStarsAccepted: false,
      historicalSnapshotOnly: true,
      liveGameConnection: false,
    });
    expect(result.opponentCoreIds).toEqual([
      "opponent-1",
      "opponent-2",
      "opponent-3",
      "opponent-4",
    ]);
  });

  it("holds stale evidence, unresolved opponents and uncertain rules", () => {
    const result = validateOpenRaceField(
      input({
        freshness: "stale",
        opponents: [
          { coreId: "opponent-1", identityStatus: "unresolved" },
          { coreId: "opponent-2", identityStatus: "confirmed" },
          { coreId: "opponent-3", identityStatus: "confirmed" },
          { coreId: "opponent-4", identityStatus: "confirmed" },
        ],
        restrictions: [
          {
            restrictionId: "unconfirmed-rule",
            kind: "other",
            value: "visible game restriction",
            evidenceStatus: "uncertain",
          },
        ],
      }),
    );
    expect(result.status).toBe("review_required");
    expect(result.reviewReasons).toEqual([
      "Historical evidence is stale or freshness is unknown.",
      "One or more opponent identities are unresolved.",
      "One or more eligibility restrictions are uncertain.",
    ]);
  });

  it("requires entered opponents and available gates to reconstruct the field", () => {
    expect(() => validateOpenRaceField(input({ availableGates: 1 }))).toThrow(
      "must equal gate count",
    );
    expect(() => validateOpenRaceField(input({ availableGates: 7 }))).toThrow(
      "cannot exceed gate count",
    );
  });

  it("rejects duplicate opponent and restriction identities", () => {
    expect(() =>
      validateOpenRaceField(
        input({
          opponents: [
            { coreId: "same", identityStatus: "confirmed" },
            { coreId: "same", identityStatus: "confirmed" },
            { coreId: "third", identityStatus: "confirmed" },
            { coreId: "fourth", identityStatus: "confirmed" },
          ],
        }),
      ),
    ).toThrow("Opponent core IDs must be unique");
    expect(() =>
      validateOpenRaceField(
        input({
          restrictions: [
            {
              restrictionId: "same-rule",
              kind: "class",
              value: "Morphed",
              evidenceStatus: "confirmed",
            },
            {
              restrictionId: "same-rule",
              kind: "element",
              value: "Fire",
              evidenceStatus: "confirmed",
            },
          ],
        }),
      ),
    ).toThrow("Restriction IDs must be unique");
  });

  it("preserves exact fee text and rejects malformed amounts", () => {
    expect(validateOpenRaceField(input()).entryFee).toEqual({
      amount: "0.0100",
      asset: "DEZ",
    });
    expect(() =>
      validateOpenRaceField(
        input({ entryFee: { amount: "1e-2", asset: "DEZ" } }),
      ),
    ).toThrow("exact non-negative decimal");
  });

  it("rejects invalid timestamps, modes and dimensions", () => {
    expect(() =>
      validateOpenRaceField(input({ capturedAt: "2026-07-21T12:00:00Z" })),
    ).toThrow("cannot predate imported evidence");
    expect(() =>
      validateOpenRaceField(input({ mode: "plane" as "car" })),
    ).toThrow("mode is invalid");
    expect(() => validateOpenRaceField(input({ distanceMeters: 0 }))).toThrow(
      "positive safe integer",
    );
  });

  it("rejects hidden current-race star fields at the runtime boundary", () => {
    expect(() =>
      validateOpenRaceField({
        ...input(),
        currentGoldStarCoreId: "opponent-1",
      } as OpenRaceFieldInput),
    ).toThrow("cannot contain current-race star input");
  });

  it("rejects hidden current-race star fields on an opponent", () => {
    expect(() =>
      validateOpenRaceField(
        input({
          opponents: [
            {
              coreId: "opponent-1",
              identityStatus: "confirmed",
              currentBlueStar: true,
            } as OpenRaceFieldInput["opponents"][number],
            { coreId: "opponent-2", identityStatus: "confirmed" },
            { coreId: "opponent-3", identityStatus: "confirmed" },
            { coreId: "opponent-4", identityStatus: "confirmed" },
          ],
        }),
      ),
    ).toThrow("cannot contain current-race star input");
  });
});
