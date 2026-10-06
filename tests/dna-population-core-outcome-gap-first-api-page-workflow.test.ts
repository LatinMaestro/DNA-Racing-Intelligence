import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-outcome-gap-first-api-page.yml";

describe("DNA population Core-outcome exact-gap first API page workflow", () => {
  it("binds exact main, the persisted cohort identity, fresh capacity and one API page", () => {
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
      "DNA_POPULATION_CORE_OUTCOME_GAP_ACQUISITION_EVALUATED_AT",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_CORE_OUTCOME_GAP_EXPECTED_CORE_SET_SHA256",
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-core-outcome-gap-measurement.test.ts",
    );
    expect(workflow).toContain(
      "group: dna-population-core-outcome-gap-acquisition-bootstrap",
    );
    expect(workflow).toContain("DNA_R2_BUCKET_NAME: dna-racing-import-preview");
    expect(workflow).not.toContain("DNA_OPEN_LAB_API_KEY");
    expect(workflow).not.toMatch(/deploy|production/iu);
  });
});
