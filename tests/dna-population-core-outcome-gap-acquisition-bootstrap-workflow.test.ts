import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-outcome-gap-acquisition-bootstrap.yml";

describe("DNA population Core-outcome gap acquisition bootstrap workflow", () => {
  it("is exact-main, explicitly armed, private, A$0-gated, and carries no DNA credential", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha");
    expect(workflow).toContain("acquisition_evaluated_at");
    expect(workflow).toContain("expected_gap_core_count");
    expect(workflow).toContain("expected_gap_core_set_sha256");
    expect(workflow).toContain("expected_missing_membership_set_sha256");
    expect(workflow).toContain("bootstrap_exact_gap_acquisition");
    expect(workflow).toContain(
      'DNA_POPULATION_CORE_OUTCOME_GAP_BOOTSTRAP: "1"',
    );
    expect(workflow).toContain(
      'DNA_POPULATION_CORE_OUTCOME_GAP_MEASUREMENT: "1"',
    );
    expect(workflow).toContain("refs/heads/main");
    expect(workflow).toContain("origin/main");
    expect(workflow).toContain(
      "hosted-preview-connected-population-core-outcome-gap-measurement.test.ts",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).not.toContain("DNA_OPEN_LAB_API_KEY");
    expect(workflow).not.toMatch(/deploy|production/iu);
    expect(workflow).not.toContain("contents: write");
  });
});
