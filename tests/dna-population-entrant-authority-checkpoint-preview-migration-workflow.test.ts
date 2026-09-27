import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-checkpoint-preview-migration.yml";

describe("DNA population entrant checkpoint Preview migration workflow", () => {
  it("is exact-main, Preview-only, explicitly armed and recoverable", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("exact_main_sha:");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('[[ "$EXPECTED_MAIN_SHA" != "${GITHUB_SHA}" ]]');
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain("checkpoint.up.sql");
    expect(workflow).toContain("checkpoint.smoke.sql");
    expect(workflow).toContain("checkpoint.down.sql");
    expect(workflow).toContain("checkpoint.removal.sql");
    expect(workflow).toContain("entrant checkpoint schema is not absent");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).not.toMatch(/echo .*DATABASE_URL|printenv|env\s*$/mu);
  });
});
