import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/core-intelligence-private-preview-verification.yml";

describe("Core Intelligence private Preview verification workflow", () => {
  it("is exact-main, explicitly armed and read-only", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain(
      '[[ "${{ inputs.execute_private_preview_verification }}" == "true" ]]',
    );
    expect(workflow).toContain(
      '[[ "$(git rev-parse origin/main)" == "$GITHUB_SHA" ]]',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      "hosted-preview-connected-core-intelligence-commissioning.test.tsx",
    );
    expect(workflow).toContain(
      "hosted-preview-connected-private-owner-page-route.test.tsx",
    );
    expect(workflow).toContain("DNA_DATABASE_RUNTIME_ROLE: dna_app_runtime");
    expect(workflow).not.toMatch(/production|deploy|INSERT|UPDATE|DELETE/iu);
  });
});
