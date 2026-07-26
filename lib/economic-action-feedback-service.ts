import {
  projectEconomicActionFeedback,
  type EconomicActionFeedback,
  type EconomicActionOperation,
} from "@/domain/economic-action-feedback";
import {
  EconomicActionConflictError,
  EconomicActionIdentityError,
} from "@/lib/economic-action-errors";

type EconomicActionServiceResult = Readonly<{
  status:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "recorded"
    | "replayed"
    | "held";
}>;

function feedbackStatus(
  result: EconomicActionServiceResult,
):
  | "identity_not_connected"
  | "persistence_not_configured"
  | "recorded"
  | "replayed"
  | "review_required" {
  return result.status === "held" ? "review_required" : result.status;
}

export async function runEconomicActionForFeedback(input: {
  operation: EconomicActionOperation;
  execute: () => Promise<EconomicActionServiceResult>;
}): Promise<EconomicActionFeedback> {
  try {
    const result = await input.execute();
    return projectEconomicActionFeedback({
      operation: input.operation,
      status: feedbackStatus(result),
    });
  } catch (error) {
    if (error instanceof EconomicActionIdentityError) {
      return projectEconomicActionFeedback({
        operation: input.operation,
        status: "identity_not_connected",
      });
    }
    if (error instanceof EconomicActionConflictError) {
      return projectEconomicActionFeedback({
        operation: input.operation,
        status: "conflict",
      });
    }
    return projectEconomicActionFeedback({
      operation: input.operation,
      status: "unexpected_failure",
    });
  }
}
