export type DeploymentAccessInput = {
  vercelEnv?: string | undefined;
  phase0ReviewEnabled?: string | undefined;
  productionApproved?: string | undefined;
};

export type DeploymentAccessDecision =
  | { allowed: true; reason: "remote_development" | "protected_preview" }
  | { allowed: false; reason: "production_disabled" | "preview_disabled" };

export function resolveDeploymentAccess(
  input: DeploymentAccessInput,
): DeploymentAccessDecision {
  if (input.vercelEnv === "production" && input.productionApproved !== "true") {
    return { allowed: false, reason: "production_disabled" };
  }

  if (input.vercelEnv === "preview" && input.phase0ReviewEnabled !== "true") {
    return { allowed: false, reason: "preview_disabled" };
  }

  return {
    allowed: true,
    reason:
      input.vercelEnv === "preview"
        ? "protected_preview"
        : "remote_development",
  };
}
