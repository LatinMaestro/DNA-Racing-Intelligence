import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-outcome-gap-first-api-page.yml";

describe("DNA population Core-outcome exact-gap first API page workflow", () => {
  it("requires exact main, explicit arming, private capacity settings and the exact-gap acquisition flag", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("execute_first_exact_gap_api_page:");
    expect(workflow).toContain(
      'DNA_POPULATION_CORE_OUTCOME_GAP_FIRST_API_PAGE: "1"',
    );
    expect(workflow).toContain(
      'DNA_POPULATION_CORE_OUTCOME_GAP_MEASUREMENT: "1"',
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-core-outcome-gap-measurement.test.ts",
    );
    expect(workflow).toContain(
      "group: dna-population-core-outcome-gap-measurement",
    );
    expect(workflow).toContain('DNA_R2_BUCKET_NAME: dna-racing-import-preview');
    expect(workflow).not.toContain("deploy");
    expect(workflow).not.toContain("production");
    expect(workflow).not.toContain("DNA_API_KEY");
  });
});
