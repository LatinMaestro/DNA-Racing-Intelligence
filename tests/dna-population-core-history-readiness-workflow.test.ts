import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-history-readiness.yml";

describe("population Core-history readiness workflow", () => {
  it("is exact-main, explicitly read-only and cannot deploy or write", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("execute_read_only_readiness:");
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main');
    expect(workflow).toContain(
      'inputs.expected_main_sha }}" != "\${GITHUB_SHA}',
    );
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-core-history-readiness.test.ts",
    );
    const connectedTest = await readFile(
      "tests/hosted-preview-connected-population-core-history-readiness.test.ts",
      "utf8",
    );
    expect(connectedTest).toContain('projectionHorizon: "single_refresh"');
    expect(connectedTest).not.toContain('projectionHorizon: "billing_window"');
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).not.toMatch(/push:\s*\n\s*branches:/u);
    expect(workflow).not.toContain("vercel");
    expect(workflow).not.toContain("allowPersistentWrite");
    expect(workflow).not.toContain("putObject");
  });
});
