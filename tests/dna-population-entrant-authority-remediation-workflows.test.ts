import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const commandPath =
  ".github/workflows/dna-population-entrant-authority-remediation-command.yml";
const verificationPath =
  ".github/workflows/dna-population-entrant-authority-remediation-verification.yml";
const continuationReadinessPath =
  ".github/workflows/dna-population-entrant-authority-remediation-continuation-readiness.yml";
const continuationCommandPath =
  ".github/workflows/dna-population-entrant-authority-remediation-continuation-command.yml";
const continuationVerificationPath =
  ".github/workflows/dna-population-entrant-authority-remediation-continuation-verification.yml";
const cohort3ReadinessPath =
  ".github/workflows/dna-population-entrant-authority-remediation-cohort-3-readiness.yml";
const cohort3CommandPath =
  ".github/workflows/dna-population-entrant-authority-remediation-cohort-3-command.yml";
const cohort3VerificationPath =
  ".github/workflows/dna-population-entrant-authority-remediation-cohort-3-verification.yml";

describe("DNA population entrant remediation workflows", () => {
  it("keeps the first remediation command dispatch-only, exact-main, bounded and Preview-only", async () => {
    const workflow = await readFile(commandPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("cohort_observed_at:");
    expect(workflow).toContain(
      "execute_first_private_preview_entrant_remediation:",
    );
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COMMAND: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "inputs.execute_first_private_preview_entrant_remediation",
    );
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-command.test.ts",
    );
    expect(workflow).toContain(
      "group: dna-population-entrant-authority-remediation-persistence",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps remediation verification dispatch-only, exact-main and read-only", async () => {
    const workflow = await readFile(verificationPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_VERIFY: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-verification.test.ts",
    );
    expect(workflow).not.toContain(
      "execute_first_private_preview_entrant_remediation",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps remediation continuation readiness dispatch-only, exact-main and read-only", async () => {
    const workflow = await readFile(continuationReadinessPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_READINESS: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-continuation-readiness.test.ts",
    );
    expect(workflow).not.toContain(
      "execute_first_private_preview_entrant_remediation",
    );
    expect(workflow).not.toContain(
      "execute_next_private_preview_entrant_remediation",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps remediation continuation command dispatch-only, exact-main, bounded and Preview-only", async () => {
    const workflow = await readFile(continuationCommandPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("cohort_observed_at:");
    expect(workflow).toContain(
      "execute_next_private_preview_entrant_remediation:",
    );
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_COMMAND: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "inputs.execute_next_private_preview_entrant_remediation",
    );
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-continuation-command.test.ts",
    );
    expect(workflow).toContain(
      "group: dna-population-entrant-authority-remediation-persistence",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps remediation continuation verification dispatch-only, exact-main and read-only", async () => {
    const workflow = await readFile(continuationVerificationPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_CONTINUATION_VERIFY: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-continuation-verification.test.ts",
    );
    expect(workflow).not.toContain(
      "execute_next_private_preview_entrant_remediation",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps cohort-3 remediation readiness dispatch-only, exact-main and read-only", async () => {
    const workflow = await readFile(cohort3ReadinessPath, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_READINESS: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-cohort-3-readiness.test.ts",
    );
    expect(workflow).not.toContain(
      "execute_private_preview_entrant_remediation_cohort_3",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps cohort-3 remediation command dispatch-only, exact-main, bounded and Preview-only", async () => {
    const workflow = await readFile(cohort3CommandPath, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("cohort_observed_at:");
    expect(workflow).toContain(
      "execute_private_preview_entrant_remediation_cohort_3:",
    );
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_COMMAND: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "inputs.execute_private_preview_entrant_remediation_cohort_3",
    );
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-cohort-3-command.test.ts",
    );
    expect(workflow).toContain(
      "group: dna-population-entrant-authority-remediation-persistence",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps cohort-3 remediation verification dispatch-only, exact-main and read-only", async () => {
    const workflow = await readFile(cohort3VerificationPath, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_REMEDIATION_COHORT_3_VERIFY: "1"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-remediation-cohort-3-verification.test.ts",
    );
    expect(workflow).not.toContain(
      "execute_private_preview_entrant_remediation_cohort_3",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
