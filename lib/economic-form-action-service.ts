export type EconomicFormActionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "invalid_input"
  | "recorded"
  | "replayed"
  | "held"
  | "failed";

export type EconomicFormActionResult = Readonly<{
  status: EconomicFormActionStatus;
  title: string;
  detail: string;
  submittedValuesEchoed: false;
  rawErrorEchoed: false;
}>;

type EconomicWriteResult = Readonly<{
  status: "recorded" | "replayed" | "held";
}>;

export type EconomicFormActionCapability<Configuration, Parsed> =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      configuration: Configuration;
      execute: (
        ownerId: string,
        parsed: Parsed,
      ) => Promise<EconomicWriteResult>;
    }>;

export const unavailableEconomicFormActionCapability = Object.freeze({
  status: "not_configured" as const,
});

const copy: Record<
  EconomicFormActionStatus,
  Readonly<{ title: string; detail: string }>
> = {
  identity_not_connected: {
    title: "Owner verification required",
    detail: "Sign in as the configured owner before recording evidence.",
  },
  persistence_not_configured: {
    title: "Evidence recording is unavailable",
    detail: "Protected owner-scoped persistence is not connected.",
  },
  invalid_input: {
    title: "Review the submitted evidence",
    detail: "The evidence did not pass the required validation.",
  },
  recorded: {
    title: "Evidence recorded",
    detail: "The evidence was recorded successfully.",
  },
  replayed: {
    title: "Evidence already recorded",
    detail: "The matching durable evidence was already recorded.",
  },
  held: {
    title: "Evidence needs review",
    detail: "The evidence was retained for owner review.",
  },
  failed: {
    title: "Evidence was not recorded",
    detail: "The request failed closed without changing stored evidence.",
  },
};

function result(status: EconomicFormActionStatus): EconomicFormActionResult {
  return {
    status,
    ...copy[status],
    submittedValuesEchoed: false,
    rawErrorEchoed: false,
  };
}

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
  return authenticatedOwnerId !== null &&
    authenticatedOwnerId === configuredOwnerId
    ? authenticatedOwnerId
    : null;
}

export async function runEconomicFormAction<Configuration, Parsed>(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  formData: FormData;
  capability: EconomicFormActionCapability<Configuration, Parsed>;
  parse: (formData: FormData, configuration: Configuration) => Parsed;
}): Promise<EconomicFormActionResult> {
  const ownerId = verifiedOwnerId(input);
  if (ownerId === null) return result("identity_not_connected");
  if (input.capability.status === "not_configured") {
    return result("persistence_not_configured");
  }

  const capability = input.capability;
  let parsed: Parsed;
  try {
    parsed = input.parse(input.formData, capability.configuration);
  } catch {
    return result("invalid_input");
  }

  try {
    const write = await capability.execute(ownerId, parsed);
    return result(write.status);
  } catch {
    return result("failed");
  }
}
