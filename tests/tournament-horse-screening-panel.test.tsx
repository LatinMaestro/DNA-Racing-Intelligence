import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TournamentHorseScreeningPanel } from "@/components/tournament-horse-screening-panel";
import type { HorseOneVOneCandidateScreening } from "@/domain/horse-one-v-one-tournament-screening";
import type { TournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";

function candidate(
  input: Partial<HorseOneVOneCandidateScreening> &
    Pick<
      HorseOneVOneCandidateScreening,
      "coreId" | "name" | "element" | "distanceMetres"
    >,
): HorseOneVOneCandidateScreening {
  return {
    status: "review_required",
    disposition: "inferred_candidate",
    expectedFieldPWinMillionths: null,
    topTenPercentStressPWinMillionths: null,
    projectedFieldOutperformanceMillionths: 550_000,
    projectedTopTenPercentOutperformanceMillionths: 510_000,
    candidateSampleCount: 14,
    candidateDirectOneVOneSampleCount: 0,
    fieldOpponentCoreCount: 8,
    stressOpponentCoreCount: 3,
    evidenceBasis: "same_mode_exact_distance_all_accepted_races",
    formatTransferStatus: "inference_only",
    provenOneVOneSpecialist: false,
    analyticalStatus: "experimental",
    decisionUseAllowed: false,
    economicStatus: "unavailable",
    economicReason: "CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED",
    reasons: [],
    ...input,
  };
}

function connectedState(): TournamentHorseScreeningState {
  return {
    connectionStatus: "snapshot_connected",
    snapshot: {
      snapshotVersion: "a".repeat(64),
      sourceSnapshotVersion: "accepted-horse-source-v3",
      modelVersion: "horse-1v1-exact-distance-transfer-v2",
      evidenceCutoff: "2026-10-18T10:00:00.000Z",
      publishedAt: "2026-10-18T11:00:00.000Z",
      candidates: [
        candidate({
          coreId: "earth:fast",
          name: "Earth Fast",
          element: "Earth",
          distanceMetres: 1400,
          status: "available",
          disposition: "screened_candidate",
          expectedFieldPWinMillionths: 620_000,
          topTenPercentStressPWinMillionths: 520_000,
          candidateDirectOneVOneSampleCount: 11,
          formatTransferStatus: "direct",
        }),
        candidate({
          coreId: "earth-review",
          name: "Earth Review",
          element: "Earth",
          distanceMetres: 1400,
        }),
        candidate({
          coreId: "fire-unavailable",
          name: "Fire Unknown",
          element: "Fire",
          distanceMetres: 1000,
          status: "unavailable",
          disposition: "evidence_unavailable",
          projectedFieldOutperformanceMillionths: null,
          projectedTopTenPercentOutperformanceMillionths: null,
          candidateSampleCount: 0,
          fieldOpponentCoreCount: 0,
          stressOpponentCoreCount: 0,
          formatTransferStatus: "unavailable",
        }),
      ],
    },
  };
}

describe("Tournament Horse screening panel", () => {
  it("keeps missing persistence explicit and renders no candidate claim", () => {
    const html = renderToStaticMarkup(
      <TournamentHorseScreeningPanel
        state={{
          connectionStatus: "persistence_not_configured",
          snapshot: null,
        }}
      />,
    );

    expect(html).toContain("snapshot repository is not configured");
    expect(html).toContain("Experimental · decision disabled");
    expect(html).not.toContain("Group screening rank");
    expect(html).not.toContain("Meets direct 50% screen");
  });

  it("groups every published candidate by element and distance with stable ranks and evidence states", () => {
    const html = renderToStaticMarkup(
      <TournamentHorseScreeningPanel state={connectedState()} />,
    );

    expect(html).toContain("Earth · 1,400 m · 2 owned Cores");
    expect(html).toContain("Fire · 1,000 m · 1 owned Cores");
    expect(html).toContain("2 meet the experimental 50% screen");
    expect(html).toContain("0 meet the experimental 50% screen");
    expect(html.match(/Group screening rank 1/g)).toHaveLength(2);
    expect(html.match(/Group screening rank 2/g)).toHaveLength(1);
    expect(html).toContain("Meets direct 50% screen");
    expect(html).toContain("Meets transfer 50% screen");
    expect(html).toContain("Evidence unavailable");
    expect(html).toContain("Transfer top-10% stress");
    expect(html).toContain("Opponent coverage");
    expect(html).toContain("Economics");
    expect(html).toContain("Screening model");
    expect(html).toContain("Published snapshot");
    expect(html).toContain(
      'href="/search-core?q=earth%3Afast&amp;coreId=earth%3Afast"',
    );
    expect(html).not.toContain("Positive EV");
  });
});
