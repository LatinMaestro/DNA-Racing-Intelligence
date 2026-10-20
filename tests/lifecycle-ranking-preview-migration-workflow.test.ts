import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Lifecycle ranking Preview migration workflow", () => {
  it("uses the managed-role smoke path while retaining full CI coverage", async () => {
    const [workflow, smoke, ci] = await Promise.all([
      readFile(
        ".github/workflows/lifecycle-ranking-preview-migration.yml",
        "utf8",
      ),
      readFile(
        "database/migrations/0130_lifecycle_ranking_evidence_snapshot.smoke.sql",
        "utf8",
      ),
      readFile(".github/workflows/ci.yml", "utf8"),
    ]);

    expect(workflow).toContain("--set skip_runtime_role=1");
    expect(workflow).toContain(
      "0130_lifecycle_ranking_evidence_snapshot.down.sql",
    );
    expect(workflow).toContain(
      "0130_lifecycle_ranking_evidence_snapshot.removal.sql",
    );
    expect(smoke).toContain("\\if :{?skip_runtime_role}");
    expect(smoke).toContain("DO $managed_owner$");
    expect(smoke).toContain("SET LOCAL ROLE dna_app_runtime;");
    expect(smoke).toContain("CREATE ROLE dna_ci_lifecycle_rls");
    expect(ci).toContain("0130_lifecycle_ranking_evidence_snapshot.smoke.sql");
    expect(ci).not.toContain(
      "0130_lifecycle_ranking_evidence_snapshot.smoke.sql --set",
    );
  });
});
