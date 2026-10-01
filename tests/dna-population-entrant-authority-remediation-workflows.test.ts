import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const commandPath =
  ".github/workflows/dna-population-entrant-authority-remediation-command.yml";
const verificationPath =
  ".github/workflows/dna-population-entrant-authority-remediation-verification.yml";

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
      'inputs.execute_first_private_preview_entrant_remediation',
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
});
