import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  season12DetailedCompetitionEntries,
  season12OfficialSchedule,
  season12OfficialScheduleAuthority,
} from "@/domain/season-12-official-schedule";

describe("Season 12 official schedule", () => {
  it("preserves all 17 published rows in chronological order", () => {
    expect(season12OfficialSchedule).toHaveLength(17);
    expect(season12OfficialSchedule[0]).toMatchObject({
      date: "2026-09-14",
      publishedDay: "Mon",
      event: "Splice 1",
      mode: "car",
      distances: { kind: "all" },
      eligibility: "unspecified",
    });
    expect(season12OfficialSchedule.at(-1)).toMatchObject({
      date: "2026-11-09",
      publishedDay: "Mon",
      event: "Double Up",
      mode: "bike",
      distances: {
        kind: "listed",
        publishedCodes: [10, 14, 20],
        metres: [1000, 1400, 2000],
      },
      eligibility: "all",
    });
    expect(
      season12OfficialSchedule.every(
        (entry, index) =>
          index === 0 || entry.date > season12OfficialSchedule[index - 1]!.date,
      ),
    ).toBe(true);
  });

  it("normalizes the confirmed calendar shorthand without losing it", () => {
    const spinBattlesBike = season12OfficialSchedule.find(
      (entry) => entry.date === "2026-09-28",
    );
    expect(spinBattlesBike).toMatchObject({
      event: "Spin Battles",
      mode: "bike",
      distances: {
        kind: "listed",
        publishedCodes: [10, 18, 22],
        metres: [1000, 1800, 2200],
      },
      eligibility: "all",
    });
  });

  it("keeps five Side Events and three Splice dates non-actionable", () => {
    const sideEvents = season12OfficialSchedule.filter(
      (entry) => entry.event === "Side Event",
    );
    expect(sideEvents).toHaveLength(5);
    expect(
      sideEvents.every(
        (entry) =>
          entry.mode === null &&
          entry.distances.kind === "unspecified" &&
          entry.eligibility === "unspecified",
      ),
    ).toBe(true);

    const spliceDates = season12OfficialSchedule.filter((entry) =>
      entry.event.startsWith("Splice "),
    );
    expect(spliceDates).toHaveLength(3);
    expect(
      spliceDates.every(
        (entry) =>
          entry.distances.kind === "all" && entry.eligibility === "unspecified",
      ),
    ).toBe(true);
    expect(season12DetailedCompetitionEntries).toHaveLength(9);
  });

  it("does not promote the calendar into complete tournament rules", () => {
    expect(season12OfficialScheduleAuthority).toMatchObject({
      season: 12,
      year: 2026,
      status: "official_owner_supplied_image",
      sourceImageSha256:
        "c6d9c1f38bff8cab308a119c89e1899215dcb74dd86a2de5e2bfc70f6f734516",
    });
    expect(season12OfficialScheduleAuthority.configurationBoundary).toContain(
      "does not establish gate counts",
    );
    expect(season12OfficialScheduleAuthority.configurationBoundary).toContain(
      "Side Event rules",
    );
  });

  it("matches the full transcribed schedule fingerprint", () => {
    expect(
      createHash("sha256")
        .update(JSON.stringify(season12OfficialSchedule))
        .digest("hex"),
    ).toBe("a1c61cd29f9c24488ebf9c870e257c55fb985b589020d7b9f13bb040afc3e45c");
  });
});
