import {
  projectEconomicActionFeedback,
  type EconomicActionFeedback,
  type EconomicActionOperation,
} from "@/domain/economic-action-feedback";
import { runEconomicActionForFeedback } from "@/lib/economic-action-feedback-service";

type EconomicActionServiceResult = Readonly<{
  status:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "recorded"
    | "replayed"
    | "held";
}>;

export type EconomicFormActionCapability<Configuration, Parsed> =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      configuration: Configuration;
      execute: (
        ownerId: string,
        parsed: Parsed,
      ) => Promise<EconomicActionServiceResult>;
    }>;

export const unavailableEconomicFormActionCapability = Object.freeze({
  status: "not_configured" as const,
});

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function verifiedOwnerId(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
}): string | null {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (
    authenticatedOwnerId === null ||
    configuredOwnerId === null ||
    authenticatedOwnerId !== configuredOwnerId
  ) {
    return null;
  }
  return authenticatedOwnerId;
}

export async function runEconomicFormAction<Configuration, Parsed>(input: {
  operation: EconomicActionOperation;
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  formData: FormData;
  capability: EconomicFormActionCapability<Configuration, Parsed>;
  parse: (formData: FormData, configuration: Configuration) => Parsed;
}): Promise<EconomicActionFeedback> {
  const ownerId = verifiedOwnerId(input);
  if (ownerId === null) {
    return projectEconomicActionFeedback({
      operation: input.operation,
      status: "identity_not_connected",
    });
  }
  if (input.capability.status === "not_configured") {
    return projectEconomicActionFeedback({
      operation: input.operation,
      status: "persistence_not_configured",
    });
  }
  const capability = input.capability;

  let parsed: Parsed;
  try {
    parsed = input.parse(input.formData, capability.configuration);
  } catch {
    return projectEconomicActionFeedback({
      operation: input.operation,
      status: "invalid_input",
    });
  }

  return runEconomicActionForFeedback({
    operation: input.operation,
    execute: () => capability.execute(ownerId, parsed),
  });
}
