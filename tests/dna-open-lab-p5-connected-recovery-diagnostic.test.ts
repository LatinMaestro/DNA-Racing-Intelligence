import { describe, expect, it } from "vitest";

import {
  connectedRecoveryFailure,
  createDnaOpenLabP5ConnectedRecoveryDiagnostic,
} from "@/lib/dna-open-lab-p5-connected-recovery-diagnostic";

describe("DNA Open Lab P5 connected recovery diagnostics", () => {
  it("reports only the allowlisted phase and next ordered case", () => {
    const diagnostic = createDnaOpenLabP5ConnectedRecoveryDiagnostic({
      phase: "ordered_case",
      completedCaseCount: 3,
    });

    expect(diagnostic).toEqual({
      phase: "ordered_case",
      completedCaseCount: 3,
      nextCaseId: "lower_rate_allowance",
    });
    expect(connectedRecoveryFailure(diagnostic).message).toBe(
      "DNA Open Lab P5 connected recovery failed: phase=ordered_case; completed_case_count=3; next_case=lower_rate_allowance.",
    );
  });

  it("reports completion without accepting provider text", () => {
    const diagnostic = createDnaOpenLabP5ConnectedRecoveryDiagnostic({
      phase: "final_provider_safety",
      completedCaseCount: 10,
    });

    expect(diagnostic.nextCaseId).toBeNull();
    expect(connectedRecoveryFailure(diagnostic).message).toContain(
      "next_case=none",
    );
  });

  it("rejects an invalid phase or case count", () => {
    expect(() =>
      createDnaOpenLabP5ConnectedRecoveryDiagnostic({
        phase: "provider_secret" as "ordered_case",
        completedCaseCount: 0,
      }),
    ).toThrow("connected recovery diagnostic failed");
    expect(() =>
      createDnaOpenLabP5ConnectedRecoveryDiagnostic({
        phase: "ordered_case",
        completedCaseCount: 11,
      }),
    ).toThrow("connected recovery diagnostic failed");
  });
});
