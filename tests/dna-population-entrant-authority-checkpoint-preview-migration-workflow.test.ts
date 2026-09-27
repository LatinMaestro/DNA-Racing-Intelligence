import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-checkpoint-preview-migration.yml";
const smokePath =
  "database/migrations/0117_dna_population_entrant_authority_checkpoint.smoke.sql";

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
    expect(workflow).toContain("NEON_API_KEY: ${{ secrets.NEON_API_KEY }}");
    expect(workflow).toContain(
      "NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}",
    );
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain("DNA_MIGRATION_DATABASE_URL=${migration_url}");
    expect(workflow).toContain('psql "${DNA_MIGRATION_DATABASE_URL}"');
    expect(workflow).toContain("--set skip_runtime_role=1");
    expect(workflow).toContain("DNA_MIGRATION_DATABASE_URL=");
    expect(workflow).not.toMatch(
      /echo .*"\$\{(?:DATABASE_URL|NEON_API_KEY|NEON_PROJECT_ID)\}"|printenv|env\s*$/mu,
    );
  });

  it("preserves normal runtime-role smoke while supporting connected owner-role proof", async () => {
    const smoke = await readFile(smokePath, "utf8");

    expect(smoke.match(/\\if :\{\?skip_runtime_role\}/gu)).toHaveLength(4);
    expect(smoke.match(/SET LOCAL ROLE dna_app_runtime;/gu)).toHaveLength(2);
    expect(smoke.match(/RESET ROLE;/gu)).toHaveLength(2);
  });
});
