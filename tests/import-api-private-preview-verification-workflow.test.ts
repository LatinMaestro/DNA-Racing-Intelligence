import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Import/API private Preview verification workflow", () => {
  it("derives and masks the exact approved least-privilege runtime binding", async () => {
    const workflow = await readFile(
      ".github/workflows/import-api-private-preview-verification.yml",
      "utf8",
    );

    expect(workflow).toContain("DNA_DATABASE_RUNTIME_ROLE: dna_app_runtime");
    expect(workflow).toContain('--role-name "${DNA_DATABASE_RUNTIME_ROLE}"');
    expect(workflow).toContain(
      '--database-name "${APPROVED_NEON_DATABASE_NAME}"',
    );
    expect(workflow).toContain('echo "::add-mask::${runtime_url}"');
    expect(workflow).toContain(
      'echo "DATABASE_URL=${runtime_url}" >> "${GITHUB_ENV}"',
    );
    expect(workflow).toContain(
      "Prove masked binding is the forced-RLS least-privilege runtime",
    );
    expect(workflow).toContain("row?.runtime_is_superuser !== false");
    expect(workflow).toContain("row?.runtime_bypasses_rls !== false");
    expect(workflow).toContain("row?.can_read_refresh !== true");
    expect(workflow).toContain("row?.refresh_force_rls !== true");
    expect(workflow).toContain('echo "DATABASE_URL=" >> "${GITHUB_ENV}"');
  });
});
