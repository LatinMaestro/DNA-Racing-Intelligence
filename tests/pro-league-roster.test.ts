import { describe, expect, it } from "vitest";

import {
  auditProLeagueRoster,
  proLeagueCurrentRules,
  type ProLeagueRosterCore,
} from "@/domain/pro-league-roster";

const elements = ["Metal", "Fire", "Earth", "Water"] as const;

function compliantRoster(size = 12): ProLeagueRosterCore[] {
  return Array.from({ length: size }, (_, index) => ({
    coreId: `core-${index + 1}`,
    displayName: `Core ${index + 1}`,
    element: elements[index % elements.length] ?? "Water",
    coreClass: index < 4 ? "Genesis" : "Morphed",
    sex: index < 8 ? "female" : "male",
    fNumber: index < 2 ? 16 + index : 11,
    inMyVault: true,
  }));
}

describe("Pro League roster audit", () => {
  it("captures the current owner-confirmed roster and substitution authority", () => {
    expect(proLeagueCurrentRules).toMatchObject({
      evidenceStatus: "owner_confirmed",
      raceMode: "bike",
      minimumRosterSize: 12,
      maximumRosterSize: 25,
      maximumSubstitutionsPerYear: 10,
      initialRosterCountsAsSubstitutions: "unresolved",
      maximumPerElement: { Metal: 7, Fire: 8, Earth: 10 },
      maximumGenesisPerElement: 2,
      maximumF5OrBelow: 5,
      maximumF10OrBelow: 12,
      minimumAboveF15: 2,
      minimumFemales: 8,
      namesRequired: true,
    });
  });

  it.each([12, 25])("accepts a compliant %i-Core roster", (size) => {
    const roster = compliantRoster(size).map((core, index) => ({
      ...core,
      element:
        size === 25
          ? index < 7
            ? ("Metal" as const)
            : index < 15
              ? ("Fire" as const)
              : ("Earth" as const)
          : core.element,
      coreClass: "Morphed" as const,
      fNumber: index < 2 ? 16 + index : 11,
    }));
    const audit = auditProLeagueRoster(roster);

    expect(audit.readiness).toBe("compliant");
    expect(audit.selectedCoreCount).toBe(size);
    expect(audit.issues).toEqual([]);
  });

  it("enforces both roster-size boundaries", () => {
    expect(auditProLeagueRoster(compliantRoster(11)).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ROSTER_MINIMUM", actual: 11 }),
      ]),
    );
    expect(auditProLeagueRoster(compliantRoster(26)).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ROSTER_MAXIMUM", actual: 26 }),
      ]),
    );
  });

  it("enforces element, Genesis, F-number, female and naming rules", () => {
    const roster = compliantRoster().map((core, index) => ({
      ...core,
      element: index < 8 ? ("Metal" as const) : ("Water" as const),
      coreClass: index < 3 ? ("Genesis" as const) : ("Morphed" as const),
      sex: index < 7 ? ("female" as const) : ("male" as const),
      fNumber: index < 6 ? 5 : index < 11 ? 10 : 15,
      displayName: index === 0 ? " " : core.displayName,
    }));
    const audit = auditProLeagueRoster(roster);

    expect(audit.readiness).toBe("incomplete");
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CORE_NAME_REQUIRED" }),
        expect.objectContaining({ code: "ELEMENT_MAXIMUM", element: "Metal" }),
        expect.objectContaining({
          code: "GENESIS_ELEMENT_CAP",
          element: "Metal",
        }),
        expect.objectContaining({ code: "F5_OR_BELOW_MAXIMUM", actual: 6 }),
        expect.objectContaining({ code: "ABOVE_F15_MINIMUM", actual: 0 }),
        expect.objectContaining({ code: "FEMALE_MINIMUM", actual: 7 }),
      ]),
    );
  });

  it("enforces the maximum 12 Cores at F10 or below", () => {
    const roster = compliantRoster(13).map((core) => ({
      ...core,
      coreClass: "Morphed" as const,
      fNumber: 10,
    }));
    expect(auditProLeagueRoster(roster).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "F10_OR_BELOW_MAXIMUM", actual: 13 }),
      ]),
    );
  });

  it("counts F15 as not above F15", () => {
    const roster = compliantRoster().map((core) => ({
      ...core,
      fNumber: 15,
    }));
    expect(auditProLeagueRoster(roster).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ABOVE_F15_MINIMUM", actual: 0 }),
      ]),
    );
  });

  it("fails closed for duplicate and unowned selections", () => {
    const roster = compliantRoster();
    roster[0] = { ...roster[0]!, inMyVault: false };
    roster.push({ ...roster[1]! });
    const audit = auditProLeagueRoster(roster);

    expect(audit.selectedCoreCount).toBe(11);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NOT_IN_MY_VAULT" }),
        expect.objectContaining({ code: "DUPLICATE_CORE" }),
        expect.objectContaining({ code: "ROSTER_MINIMUM", actual: 11 }),
      ]),
    );
  });

  it("rejects malformed Core ID and F-number evidence", () => {
    expect(() =>
      auditProLeagueRoster([{ ...compliantRoster()[0]!, coreId: " " }]),
    ).toThrow("Core ID");
    expect(() =>
      auditProLeagueRoster([{ ...compliantRoster()[0]!, fNumber: 0 }]),
    ).toThrow("F-number");
  });
});
