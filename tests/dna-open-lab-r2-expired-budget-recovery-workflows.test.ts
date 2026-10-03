import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationWorkflowPath =
  ".github/workflows/dna-open-lab-r2-expired-budget-recovery-preview-migration.yml";
const recoveryWorkflowPath =
  ".github/workflows/dna-open-lab-r2-expired-budget-recovery.yml";

describe("expired R2 budget recovery workflows", () => {
  it("keeps the schema apply exact-main, Preview-only and reversible", async () => {
    const workflow = await readFile(migrationWorkflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("exact_main_sha:");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "0120_dna_open_lab_r2_expired_budget_recovery.up.sql",
    );
    expect(workflow).toContain(
      "0120_dna_open_lab_r2_expired_budget_recovery.smoke.sql",
    );
    expect(workflow).toContain(
      "0120_dna_open_lab_r2_expired_budget_recovery.down.sql",
    );
    expect(workflow).toContain(
      "0120_dna_open_lab_r2_expired_budget_recovery.removal.sql",
    );
    expect(workflow).toContain("--set skip_runtime_role=1");
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("binds recovery to exact fresh aggregate evidence and never receives R2 write credentials", async () => {
    const workflow = await readFile(recoveryWorkflowPath, "utf8");

    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("expected_ledger_window_end_at:");
    expect(workflow).toContain("expected_reserved_storage_bytes:");
    expect(workflow).toContain("expected_reserved_class_a_operations:");
    expect(workflow).toContain("expected_reserved_class_b_operations:");
    expect(workflow).toContain("execute_expired_r2_budget_recovery:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      "dna.reconcile_expired_dna_open_lab_r2_budget_window",
    );
    expect(workflow).toContain("reconciled_reservation_count > 0");
    expect(workflow).toContain("RAISE EXCEPTION");
    expect(workflow).toContain("expired R2 budget recovery state drifted");
    expect(workflow).toContain("expired R2 budget recovery receipt drifted");
    expect(workflow).not.toContain("\\quit");
    expect(workflow).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(workflow).not.toContain("DNA_R2_ACCESS_KEY_ID");
    expect(workflow).not.toContain("DNA_R2_SECRET_ACCESS_KEY");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
