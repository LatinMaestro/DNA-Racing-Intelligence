import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadinessWorkspace } from "@/components/readiness-workspace";
import { assessPrivateProductionReadiness } from "@/domain/private-production-readiness";
import type { TournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";

const unavailableHorseScreeningState: TournamentHorseScreeningState = {
  connectionStatus: "snapshot_unavailable",
  snapshot: null,
};

const readiness = assessPrivateProductionReadiness({
  assessmentId: "synthetic-readiness",
  assessmentVersion: "readiness-v1",
  assessedAt: "2026-07-23T01:00:00.000Z",
  evidenceCurrentThrough: "2026-07-23T00:00:00.000Z",
  evidenceFreshness: "current",
  exactHeadSha: "a".repeat(40),
  gates: {
    gateA: "accepted",
    gateB: "not_accepted",
    gateC: "not_accepted",
    gateD: "not_accepted",
    gateE: "not_accepted",
  },
  exactHeadCi: "passed",
  representativePrivateImport: "not_run",
  recoveryValidation: "passed",
  performanceCapacity: "not_run",
  securityPrivacy: "not_run",
  accessibilityResponsive: "not_run",
  moduleBoundaries: {
    vaultPerformance: {
      readModel: "fixture_verified",
      economicEvidenceWrites: "fixture_verified",
    },
    openRace: {
      readModel: "fixture_verified",
      fieldLock: "fixture_verified",
      postLockObservation: "fixture_verified",
    },
    lifecycle: {
      readModel: "fixture_verified",
      economicEvidenceWrites: "fixture_verified",
    },
  },
  migrations: "reversible_verified",
  knownLimitationsDocumented: true,
  productionDisabled: true,
  customDomainAttached: false,
  publicRoutesExposed: false,
  fullPrivateDataInProduction: false,
  recurringPaidInfrastructureEnabled: false,
  ownerGateFApproval: false,
  activationRequested: false,
});

describe("Readiness workspace", () => {
  it("renders a fail-closed empty state", () => {
    const html = renderToStaticMarkup(
      <ReadinessWorkspace
        assessmentId={null}
        assessedAt={null}
        assessmentVersion={null}
        connectionStatus="identity_not_connected"
        evidenceCurrentThrough={null}
        evidenceFreshness={null}
        exactHeadSha={null}
        horseScreeningState={unavailableHorseScreeningState}
        readiness={null}
      />,
    );
    expect(html).toContain("Owner identity not connected");
    expect(html).toContain("No accepted readiness evidence");
    expect(html).toContain("Production activation unavailable");
  });

  it("renders bound blockers without an activation action", () => {
    const html = renderToStaticMarkup(
      <ReadinessWorkspace
        assessmentId="synthetic-readiness"
        assessedAt="2026-07-23T01:00:00.000Z"
        assessmentVersion="readiness-v1"
        connectionStatus="read_model_connected"
        evidenceCurrentThrough="2026-07-23T00:00:00.000Z"
        evidenceFreshness="current"
        exactHeadSha={"a".repeat(40)}
        horseScreeningState={unavailableHorseScreeningState}
        readiness={readiness}
      />,
    );
    expect(html).toContain("synthetic-readiness · readiness-v1");
    expect(html).toContain("Evidence current through");
    expect(html).toContain("Representative Private Import");
    expect(html).toContain("Commissioning module boundaries");
    expect(html).toContain("Vault Performance");
    expect(html).toContain("Field-lock publication");
    expect(html).toContain("Fixture verified");
    expect(html).toContain("Review Required");
    expect(html).not.toContain("Enable Production");
  });

  it.each([
    ["identity_not_connected", "Identity not connected"],
    ["persistence_not_configured", "Persistence not configured"],
    ["snapshot_unavailable", "Not published"],
    ["snapshot_read_failed", "Read failed"],
    ["snapshot_invalid", "Integrity failed"],
  ] as const)(
    "renders the %s Horse publication state",
    (connectionStatus, copy) => {
      const html = renderToStaticMarkup(
        <ReadinessWorkspace
          assessmentId={null}
          assessedAt={null}
          assessmentVersion={null}
          connectionStatus="read_model_connected"
          evidenceCurrentThrough={null}
          evidenceFreshness={null}
          exactHeadSha={null}
          horseScreeningState={{ connectionStatus, snapshot: null }}
          readiness={null}
        />,
      );
      expect(html).toContain("Horse screening publication");
      expect(html).toContain(copy);
    },
  );

  it("renders compact connected Horse publication evidence", () => {
    const html = renderToStaticMarkup(
      <ReadinessWorkspace
        assessmentId={null}
        assessedAt={null}
        assessmentVersion={null}
        connectionStatus="read_model_connected"
        evidenceCurrentThrough={null}
        evidenceFreshness={null}
        exactHeadSha={null}
        horseScreeningState={{
          connectionStatus: "snapshot_connected",
          snapshot: {
            snapshotVersion: "b".repeat(64),
            sourceSnapshotVersion: "accepted-source-v1",
            modelVersion: "horse-1v1-exact-distance-transfer-v2",
            evidenceCutoff: "2026-10-18T00:00:00.000Z",
            publishedAt: "2026-10-18T01:00:00.000Z",
            candidates: [
              {
                coreId: "horse-1",
                name: "Synthetic Horse",
                element: "Fire",
                distanceMetres: 1000,
                status: "available",
                disposition: "screened_candidate",
                expectedFieldPWinMillionths: 600_000,
                topTenPercentStressPWinMillionths: 500_000,
                projectedFieldOutperformanceMillionths: 100_000,
                projectedTopTenPercentOutperformanceMillionths: 0,
                candidateSampleCount: 10,
                candidateDirectOneVOneSampleCount: 10,
                fieldOpponentCoreCount: 2,
                stressOpponentCoreCount: 1,
                evidenceBasis: "same_mode_exact_distance_all_accepted_races",
                formatTransferStatus: "direct",
                provenOneVOneSpecialist: false,
                analyticalStatus: "experimental",
                decisionUseAllowed: false,
                economicStatus: "unavailable",
                economicReason: "CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED",
                reasons: ["Synthetic fixture"],
              },
            ],
          },
        }}
        readiness={null}
      />,
    );
    expect(html).toContain("Connected");
    expect(html).toContain("accepted-source-v1");
    expect(html).toContain("2026-10-18T00:00:00.000Z");
    expect(html).not.toContain("Synthetic Horse");
  });
});
