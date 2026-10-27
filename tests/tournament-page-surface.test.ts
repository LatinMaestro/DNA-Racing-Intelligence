import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Tournament owner surface", () => {
  it("omits the retired Independent 1v1 screening journey and its database read", () => {
    const page = readFileSync("app/(private)/tournaments/page.tsx", "utf8");

    expect(page).not.toContain("TournamentHorseScreeningPanel");
    expect(page).not.toContain("loadTournamentHorseScreeningState");
    expect(page).not.toContain(
      "neonTournamentHorseScreeningRepositoryFromEnvironment",
    );
    expect(page).toContain("TournamentConfigurationForm");
    expect(page).toContain("TournamentWorkspace");
  });
});
