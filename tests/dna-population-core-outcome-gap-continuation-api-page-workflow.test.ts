import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-outcome-gap-continuation-api-page.yml";

const connectedTestPath =
  "tests/hosted-preview-connected-population-core-outcome-gap-measurement.test.ts";

describe("DNA population Core-outcome exact-gap continuation API page workflow", () => {
  it("reconciles once, advances a bounded page batch and requeues safely", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const connectedTest = readFileSync(connectedTestPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("maximum_pages:");
    expect(workflow).toContain('default: "300"');
    expect(workflow).toContain("execute_next_exact_gap_api_page:");
    expect(workflow).toContain(
      'DNA_POPULATION_CORE_OUTCOME_GAP_CONTINUE_API_PAGE: "1"',
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
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("timeout-minutes: 150");
    expect(connectedTest).toContain("135 * 60_000");
    expect(workflow).toContain("id: acquire");
    expect(workflow).toContain(
      "steps.acquire.outputs.batch_status == 'advanced'",
    );
    expect(workflow).toContain(
      "gh workflow run dna-population-core-outcome-gap-continuation-api-page.yml",
    );
    expect(workflow).toContain(
      "group: dna-population-core-outcome-gap-acquisition-bootstrap",
    );
    expect(workflow).toContain("DNA_R2_BUCKET_NAME: dna-racing-import-preview");
    expect(workflow).not.toContain("DNA_OPEN_LAB_API_KEY");
    expect(workflow).not.toMatch(/deploy|production/iu);
  });
});
