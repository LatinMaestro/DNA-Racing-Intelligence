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
    expect(workflow).toContain("deploy --yes");
    expect(workflow).not.toContain("deploy --prebuilt");
    expect(workflow).not.toContain("vercel build");
    expect(workflow).not.toMatch(/--prod(?:uction)?\b/u);
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(workflow).toContain(
      "AUTHORIZED_CLERK_USER_ID: ${{ secrets.AUTHORIZED_CLERK_USER_ID }}",
    );
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain(
      "DNA_DATABASE_OWNER_ID: ${{ secrets.DNA_DATABASE_OWNER_ID }}",
    );
    expect(workflow).toContain("DNA_DATABASE_RUNTIME_ROLE: dna_app_runtime");
    expect(workflow).toContain('ENABLE_PHASE0_REVIEW: "true"');
    expect(workflow).toContain("synchronize_preview_runtime");
    expect(workflow).toContain("scripts/vercel-preview-environment-sync.mjs");
    expect(workflow).toContain("--environment=preview");
    expect(workflow).toContain("--validate-only");
    expect(workflow).toContain("401|403)");
    expect(workflow).toContain("302|303|307|308)");
    expect(workflow).toContain(
      "https://vercel.com/login*|https://vercel.com/sso-api*",
    );
    expect(workflow).toContain('--dump-header "${headers}"');
    expect(workflow).toContain(
      "The Preview did not fail closed to an unauthenticated request",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY|DNA_R2_/u);
  });
});
