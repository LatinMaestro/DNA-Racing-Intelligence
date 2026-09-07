import { describe, expect, it } from "vitest";

import {
  buildProLeagueRosterSubstitution,
  buildProLeagueRosterVersion,
  type ProLeagueRosterVersionMemberInput,
} from "@/domain/pro-league-roster-version";
import type { ProLeagueRosterCore } from "@/domain/pro-league-roster";

const elements = ["Metal", "Fire", "Earth", "Water"] as const;
const cutoff = "2026-09-03T00:00:00.000Z";

function core(index: number): ProLeagueRosterCore {
  return {
    coreId: `core-${index}`,
    displayName: `Core ${index}`,
    element: elements[(index - 1) % elements.length]!,
    coreClass: "Morphed",
    sex: index <= 4 ? "female" : "male",
    fNumber: index <= 2 ? 16 : 11,
    inMyVault: true,
  };
}

function member(
  value: ProLeagueRosterCore,
  disposition: "rostered" | "alternate" = "rostered",
): ProLeagueRosterVersionMemberInput {
  return {
    core: value,
    disposition,
    role: disposition === "alternate" ? "alternate" : "nucleus",
    reason: "Exact-format evidence snapshot retained for review.",
    evidence: {
      asOf: "2026-09-02T23:00:00.000Z",
      generationId: "generation-1",
      sha256: "a".repeat(64),
      confidence: "moderate",
    },
  };
}

function version(
  rosterVersionId: string,
  versionNumber: number,
  roster = Array.from({ length: 12 }, (_, index) => core(index + 1)),
) {
  return buildProLeagueRosterVersion({
    rosterVersionId,
    versionNumber,
    initialRosterCountingPolicy: "unresolved",
    evidenceCutoffAt: cutoff,
    rationale: "Quality-first 12-Core nucleus pending deeper API evidence.",
    members: [
      ...roster.map((value) => member(value)),
      member(core(90), "alternate"),
    ],
  });
}

describe("Pro League roster versions", () => {
  it("builds an immutable rule-valid roster and separate alternate lane", () => {
    const result = version("roster-v1", 1);

    expect(result).toMatchObject({
      rosterVersionId: "roster-v1",
      versionNumber: 1,
      initialRosterCountingPolicy: "unresolved",
      audit: { readiness: "compliant", selectedCoreCount: 12 },
    });
    expect(result.rosteredCoreIds).toHaveLength(12);
    expect(result.alternateCoreIds).toEqual(["core-90"]);
    expect(result.members.at(-1)).toMatchObject({
      disposition: "alternate",
      role: "alternate",
      position: 1,
    });
  });

  it("rejects invalid roster authority, duplicate members and future evidence", () => {
    expect(() =>
      buildProLeagueRosterVersion({
        rosterVersionId: "roster-short",
        versionNumber: 1,
        initialRosterCountingPolicy: "unresolved",
        evidenceCutoffAt: cutoff,
        rationale: "Too short.",
        members: Array.from({ length: 11 }, (_, index) =>
          member(core(index + 1)),
        ),
      }),
    ).toThrow("ROSTER_MINIMUM");

    const repeated = member(core(1));
    expect(() =>
      buildProLeagueRosterVersion({
        rosterVersionId: "roster-duplicate",
        versionNumber: 1,
        initialRosterCountingPolicy: "unresolved",
        evidenceCutoffAt: cutoff,
        rationale: "Duplicate.",
        members: [repeated, repeated],
      }),
    ).toThrow("repeats Core");

    expect(() =>
      buildProLeagueRosterVersion({
        rosterVersionId: "roster-future",
        versionNumber: 1,
        initialRosterCountingPolicy: "unresolved",
        evidenceCutoffAt: cutoff,
        rationale: "Future evidence.",
        members: Array.from({ length: 12 }, (_, index) => ({
          ...member(core(index + 1)),
          evidence: {
            ...member(core(index + 1)).evidence,
            asOf: "2026-09-03T00:00:01.000Z",
          },
        })),
      }),
    ).toThrow("exceeds its version cutoff");
  });

  it("requires alternate role/disposition agreement", () => {
    expect(() =>
      buildProLeagueRosterVersion({
        rosterVersionId: "roster-role",
        versionNumber: 1,
        initialRosterCountingPolicy: "unresolved",
        evidenceCutoffAt: cutoff,
        rationale: "Role mismatch.",
        members: Array.from({ length: 12 }, (_, index) => ({
          ...member(core(index + 1)),
          ...(index === 0 ? { role: "alternate" as const } : {}),
        })),
      }),
    ).toThrow("role and disposition must agree");
  });

  it("derives one auditable substitution between consecutive versions", () => {
    const before = version("roster-v1", 1);
    const changed = Array.from({ length: 12 }, (_, index) =>
      index === 11 ? core(13) : core(index + 1),
    );
    changed[3] = { ...changed[3]!, sex: "female" };
    const after = version("roster-v2", 2, changed);

    expect(
      buildProLeagueRosterSubstitution({
        seasonYear: 2026,
        substitutionNumber: 1,
        from: before,
        to: after,
        reason: "Stronger exact-format evidence at a roster gap.",
        evidence: {
          asOf: "2026-09-02T23:30:00.000Z",
          generationId: "generation-1",
          sha256: "b".repeat(64),
          confidence: "strong",
        },
      }),
    ).toMatchObject({
      outgoingCoreId: "core-12",
      incomingCoreId: "core-13",
      substitutionNumber: 1,
    });
  });

  it("rejects multi-Core swaps and annual budget overflow", () => {
    const before = version("roster-v1", 1);
    const changed = Array.from({ length: 12 }, (_, index) =>
      index >= 10 ? core(index + 10) : core(index + 1),
    );
    changed[3] = { ...changed[3]!, sex: "female" };
    const after = version("roster-v2", 2, changed);

    expect(() =>
      buildProLeagueRosterSubstitution({
        seasonYear: 2026,
        substitutionNumber: 1,
        from: before,
        to: after,
        reason: "Invalid two-Core swap.",
        evidence: {
          asOf: "2026-09-02T23:30:00.000Z",
          generationId: "generation-1",
          sha256: "b".repeat(64),
          confidence: "strong",
        },
      }),
    ).toThrow("exactly one Core");

    expect(() =>
      buildProLeagueRosterSubstitution({
        seasonYear: 2026,
        substitutionNumber: 11,
        from: before,
        to: version("roster-v2", 2, [
          ...Array.from({ length: 11 }, (_, index) => core(index + 1)),
          core(13),
        ]),
        reason: "Over budget.",
        evidence: {
          asOf: "2026-09-02T23:30:00.000Z",
          generationId: "generation-1",
          sha256: "b".repeat(64),
          confidence: "strong",
        },
      }),
    ).toThrow("annual substitution number");
  });
});
