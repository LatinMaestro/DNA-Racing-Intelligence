import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-outcome-gap-measurement.yml";

describe("DNA population Core-outcome exact-gap workflow", () => {
  it("is exact-main, read-only, private and has no DNA API credential", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("execute_read_only_measurement:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain(
      'DNA_POPULATION_CORE_OUTCOME_GAP_MEASUREMENT: "1"',
    );
    expect(workflow).toContain(
      "hosted-preview-connected-population-core-outcome-gap-measurement.test.ts",
    );
    expect(workflow).toContain(
      '[[ "${{ inputs.expected_main_sha }}" != "${GITHUB_SHA}" ]]',
    );
    expect(workflow).toContain(
      '[[ "$(git rev-parse origin/main)" != "${GITHUB_SHA}" ]]',
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).not.toMatch(/DNA_(?:OPEN_LAB_)?API_KEY/u);
    expect(workflow).not.toMatch(/deploy|migration|production/iu);
  });
});
