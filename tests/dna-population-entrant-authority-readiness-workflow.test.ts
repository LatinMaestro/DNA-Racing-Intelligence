import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-readiness.yml";

describe("DNA population entrant authority commissioning readiness workflow", () => {
  it("is dispatch-only, exact-main, Preview-only and does not arm entrant persistence", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "$GITHUB_SHA"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_READINESS: "1"',
    );
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-readiness.test.ts",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toContain(
      "execute_one_private_preview_entrant_cohort",
    );
    expect(workflow).not.toContain(
      "hosted-preview-connected-population-entrant-authority-cohort-command.test.ts",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
