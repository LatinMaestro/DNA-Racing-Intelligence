import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-history-authority-preview-migration.yml";

describe("population Core-history authority Preview migration workflow", () => {
  it("is exact-main, private Preview-only, reversible and fails closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("exact_main_sha:");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "0121_dna_population_core_history_authority.up.sql",
    );
    expect(workflow).toContain(
      "0121_dna_population_core_history_authority.smoke.sql",
    );
    expect(workflow).toContain(
      "0121_dna_population_core_history_authority.down.sql",
    );
    expect(workflow).toContain(
      "0121_dna_population_core_history_authority.removal.sql",
    );
    expect(workflow).toContain("--set skip_runtime_role=1");
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain("set -euo pipefail");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
