import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-open-lab-r2-budget-ledger-diagnostic.yml";

describe("R2 budget ledger diagnostic workflow", () => {
  it("is exact-main, Preview-only and read-only", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("DNA_R2_BUDGET_LEDGER_DIAGNOSTIC");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-r2-budget-ledger-diagnostic.test.ts",
    );
    expect(workflow).toContain(
      '[[ "$(git rev-parse origin/main)" != "${GITHUB_SHA}" ]]',
    );
    expect(workflow).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(workflow).not.toContain("DNA_R2_ACCESS_KEY_ID");
    expect(workflow).not.toContain("DNA_R2_SECRET_ACCESS_KEY");
    expect(workflow).not.toContain("execute_");
    expect(workflow).not.toMatch(/production/iu);
  });
});
