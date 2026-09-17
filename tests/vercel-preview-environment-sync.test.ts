import { describe, expect, it, vi } from "vitest";

import {
  previewEnvironmentSpecification,
  syncPreviewEnvironment,
} from "../scripts/vercel-preview-environment-sync.mjs";
import type { PreviewEnvironmentRunner } from "../scripts/vercel-preview-environment-sync.mjs";

const validEnvironment = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public-value",
  CLERK_SECRET_KEY: "sk_live_private-value",
  AUTHORIZED_CLERK_USER_ID: "user_owner-value",
  DATABASE_URL:
    "postgresql://dna_app_runtime:private@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  DNA_DATABASE_OWNER_ID: "database-owner-id",
  DNA_DATABASE_RUNTIME_ROLE: "dna_app_runtime",
  ENABLE_PHASE0_REVIEW: "1",
  VERCEL_TOKEN: "vercel-private-token",
};

describe("Vercel Preview environment synchronization", () => {
  it("keeps the public Clerk key/config switches readable and every private binding secret", () => {
    expect(previewEnvironmentSpecification(validEnvironment)).toEqual([
      expect.objectContaining({
        name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        visibility: "config",
      }),
      expect.objectContaining({
        name: "CLERK_SECRET_KEY",
        visibility: "secret",
      }),
      expect.objectContaining({
        name: "AUTHORIZED_CLERK_USER_ID",
        visibility: "secret",
      }),
      expect.objectContaining({ name: "DATABASE_URL", visibility: "secret" }),
      expect.objectContaining({
        name: "DNA_DATABASE_OWNER_ID",
        visibility: "secret",
      }),
      expect.objectContaining({
        name: "DNA_DATABASE_RUNTIME_ROLE",
        visibility: "config",
      }),
      expect.objectContaining({
        name: "ENABLE_PHASE0_REVIEW",
        visibility: "config",
      }),
    ]);
  });

  it("updates Preview only and sends values over stdin", () => {
    const runner = vi.fn<PreviewEnvironmentRunner>(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));

    const result = syncPreviewEnvironment({
      environment: validEnvironment,
      runner,
    });

    expect(result).toHaveLength(7);
    expect(runner).toHaveBeenCalledTimes(7);
    for (const call of runner.mock.calls) {
      expect(call[0]).toBe("vercel");
      expect(call[1]).toContain("preview");
      expect(call[1]).toContain("--force");
      expect(call[1]).not.toContain("production");
      expect(call[1].join(" ")).not.toContain(call[2].input);
    }
  });

  it("fails closed for a Production database, missing owner, or disabled Preview", () => {
    expect(() =>
      previewEnvironmentSpecification({
        ...validEnvironment,
        DATABASE_URL:
          "postgresql://production_admin:private@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require",
      }),
    ).toThrow("runtime role");
    expect(() =>
      previewEnvironmentSpecification({
        ...validEnvironment,
        DNA_DATABASE_OWNER_ID: "",
      }),
    ).toThrow("DNA_DATABASE_OWNER_ID");
    expect(() =>
      previewEnvironmentSpecification({
        ...validEnvironment,
        ENABLE_PHASE0_REVIEW: "0",
      }),
    ).toThrow("explicitly enable Preview");
  });

  it("redacts every environment value if Vercel rejects a transfer", () => {
    const runner = vi.fn<PreviewEnvironmentRunner>(() => ({
      status: 1,
      stdout: "",
      stderr: `rejected ${validEnvironment.DATABASE_URL} ${validEnvironment.VERCEL_TOKEN}`,
    }));

    expect(() =>
      syncPreviewEnvironment({ environment: validEnvironment, runner }),
    ).toThrow(/rejected \[REDACTED\] \[REDACTED\]/u);
  });
});
