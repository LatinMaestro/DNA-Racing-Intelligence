import { describe, expect, it } from "vitest";
import { resolveDeploymentAccess } from "@/lib/deployment-access";

describe("deployment fail-closed policy", () => {
  it("denies Production without explicit Gate F approval", () => {
    expect(resolveDeploymentAccess({ vercelEnv: "production" })).toEqual({
      allowed: false,
      reason: "production_disabled",
    });
  });

  it("denies an unprotected Phase 0 Preview", () => {
    expect(resolveDeploymentAccess({ vercelEnv: "preview" })).toEqual({
      allowed: false,
      reason: "preview_disabled",
    });
  });

  it("allows an explicitly enabled protected Preview", () => {
    expect(
      resolveDeploymentAccess({
        vercelEnv: "preview",
        phase0ReviewEnabled: "true",
      }),
    ).toEqual({
      allowed: true,
      reason: "protected_preview",
    });
  });
});
