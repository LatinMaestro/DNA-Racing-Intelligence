import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadinessWorkspace } from "@/components/readiness-workspace";
import { assessPrivateProductionReadiness } from "@/domain/private-production-readiness";

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
        readiness={readiness}
      />,
    );
    expect(html).toContain("synthetic-readiness · readiness-v1");
    expect(html).toContain("Evidence current through");
    expect(html).toContain("Representative Private Import");
    expect(html).toContain("Review Required");
    expect(html).not.toContain("Enable Production");
  });
});
