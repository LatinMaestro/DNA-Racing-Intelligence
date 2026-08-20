import { describe, expect, it } from "vitest";

import {
  auditProLeagueRoster,
  proLeagueAnnouncementRules,
  type ProLeagueRosterCore,
} from "@/domain/pro-league-roster";

const elements = ["Metal", "Fire", "Earth", "Water"] as const;

function compliantRoster(): ProLeagueRosterCore[] {
  return Array.from({ length: 25 }, (_, index) => {
    const element = elements[index % elements.length] ?? "Metal";
    return {
      coreId: "core-" + (index + 1),
      displayName: "Core " + (index + 1),
      element,
      coreClass: index < 8 ? "Genesis" : "Morphed",
      sex: index < 8 ? "female" : "male",
      fNumber: index < 5 ? 15 + index : 10,
      inMyVault: true,
    };
  });
}

describe("Pro League roster audit", () => {
  it("captures only the published provisional requirements", () => {
    expect(proLeagueAnnouncementRules).toMatchObject({
      evidenceStatus: "provisional",
      primaryMode: "bike",
      rosterSize: 25,
      minimumPerElement: 5,
      maximumGenesisPerElement: 2,
      minimumFemales: 8,
      minimumF15Plus: 5,
    });
  });

  it("accepts a unique owned roster that meets every hard boundary", () => {
    const audit = auditProLeagueRoster(compliantRoster());

    expect(audit.readiness).toBe("compliant");
    expect(audit.selectedCoreCount).toBe(25);
    expect(audit.issues).toEqual([]);
    expect(audit.breedingPriorities).toEqual([]);
  });

  it("reports element, female and F15+ gaps as uncertain breeding priorities", () => {
    const roster = compliantRoster()
      .slice(0, 20)
      .map((core, index) => ({
        ...core,
        element: index < 14 ? ("Metal" as const) : core.element,
        sex: "male" as const,
        fNumber: 10,
        coreClass: "Morphed" as const,
      }));
    const audit = auditProLeagueRoster(roster);

    expect(audit.readiness).toBe("incomplete");
    expect(audit.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "ROSTER_SIZE",
        "ELEMENT_MINIMUM",
        "FEMALE_MINIMUM",
        "F15_PLUS_MINIMUM",
      ]),
    );
    expect(audit.breedingPriorities.map(({ target }) => target)).toEqual(
      expect.arrayContaining(["element", "female", "f15_plus"]),
    );
    expect(
      audit.breedingPriorities.every(({ guidance }) =>
        /not|uncertain|Do not/i.test(guidance),
      ),
    ).toBe(true);
  });

  it("fails closed for duplicate, unowned and over-cap Genesis selections", () => {
    const roster = compliantRoster();
    roster[0] = { ...roster[0]!, inMyVault: false };
    roster[8] = {
      ...roster[8]!,
      element: "Metal",
      coreClass: "Genesis",
    };
    roster.push({ ...roster[1]! });

    const audit = auditProLeagueRoster(roster);

    expect(audit.readiness).toBe("incomplete");
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NOT_IN_MY_VAULT" }),
        expect.objectContaining({ code: "DUPLICATE_CORE" }),
        expect.objectContaining({
          code: "GENESIS_ELEMENT_CAP",
          element: "Metal",
        }),
      ]),
    );
  });

  it("rejects malformed core identity and F-number evidence", () => {
    expect(() =>
      auditProLeagueRoster([
        {
          ...compliantRoster()[0]!,
          coreId: " ",
        },
      ]),
    ).toThrow("identity");
    expect(() =>
      auditProLeagueRoster([
        {
          ...compliantRoster()[0]!,
          fNumber: 0,
        },
      ]),
    ).toThrow("F-number");
  });
});
