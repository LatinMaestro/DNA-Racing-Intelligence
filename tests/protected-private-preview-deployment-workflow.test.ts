import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/protected-private-preview-deployment.yml";

describe("protected private Preview deployment workflow", () => {
  it("is manual, exact-main, Preview-only and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      'inputs.expected_main_sha }}" != "${GITHUB_SHA}',
    );
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain(
      `grep -Eq '\"deploymentEnabled\"[[:space:]]*:[[:space:]]*false' vercel.json`,
    );
    expect(workflow).toContain("--environment=preview");
    expect(workflow).toContain("npm install --global vercel@50.1.6");
    expect(workflow).toContain("deploy --prebuilt --yes");
    expect(workflow).not.toMatch(/--prod(?:uction)?\b/u);
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(workflow).toContain("401|403|307|308");
    expect(workflow).toContain(
      "The Preview did not fail closed to an unauthenticated request.",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/DATABASE_URL|DNA_OPEN_LAB_API_KEY|DNA_R2_/u);
  });
});
