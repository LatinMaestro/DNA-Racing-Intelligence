import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-bike-population-history-read-only-measurement.yml";

describe("Bike population history read-only measurement workflow", () => {
  it("requires exact main, an explicit arm and the bounded aggregate connected test", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("execute_read_only_measurement:");
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main');
    expect(workflow).toContain(
      'inputs.expected_main_sha }}" != "${GITHUB_SHA}',
    );
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-bike-population-history-measurement.test.ts",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).not.toMatch(/push:\s*\n\s*branches:/u);
    expect(workflow).not.toContain("vercel");
    expect(workflow).not.toContain("putObject");
  });
});
