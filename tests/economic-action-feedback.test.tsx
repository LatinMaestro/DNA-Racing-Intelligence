import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EconomicActionFeedback } from "@/components/economic-action-feedback";
import { projectEconomicActionFeedback } from "@/domain/economic-action-feedback";

describe("economic action feedback", () => {
  it("projects a recorded outcome without echoing submitted values", () => {
    expect(
      projectEconomicActionFeedback({
        operation: "manual_ledger",
        status: "recorded",
      }),
    ).toMatchObject({
      role: "status",
      live: "polite",
      tone: "success",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
      invalidFieldLabels: [],
    });
  });

  it("projects invalid fields from reviewed labels only", () => {
    const feedback = projectEconomicActionFeedback({
      operation: "tournament_payout",
      status: "invalid_input",
      invalidFields: ["amount", "allocation"],
    });

    expect(feedback).toMatchObject({
      role: "alert",
      live: "assertive",
      invalidFieldLabels: ["Exact amount", "Allocation"],
    });
    expect(JSON.stringify(feedback)).not.toContain("private");
  });

  it("rejects repeated fields and fields on an unrelated outcome", () => {
    expect(() =>
      projectEconomicActionFeedback({
        operation: "core_sale",
        status: "invalid_input",
        invalidFields: ["amount", "amount"],
      }),
    ).toThrow("must be unique");

    expect(() =>
      projectEconomicActionFeedback({
        operation: "core_sale",
        status: "recorded",
        invalidFields: ["amount"],
      }),
    ).toThrow("only allowed for invalid input");
  });

  it("uses generic failure copy instead of raw exception details", () => {
    const feedback = projectEconomicActionFeedback({
      operation: "burn_bgc_credit",
      status: "unexpected_failure",
    });

    expect(feedback.detail).toContain("failed safely");
    expect(feedback.rawErrorEchoed).toBe(false);
  });

  it("renders an assertive semantic alert with invalid-field labels", () => {
    const html = renderToStaticMarkup(
      <EconomicActionFeedback
        feedback={projectEconomicActionFeedback({
          operation: "breeding_evidence",
          status: "invalid_input",
          invalidFields: ["occurred_at", "breeding_event"],
        })}
        headingId="economic-feedback"
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-labelledby="economic-feedback"');
    expect(html).toContain("Occurrence time");
    expect(html).toContain("Breeding event");
  });

  it("keeps unavailable persistence explicit and non-successful", () => {
    expect(
      projectEconomicActionFeedback({
        operation: "core_burn",
        status: "persistence_not_configured",
      }),
    ).toMatchObject({
      role: "status",
      tone: "warning",
      title: "Evidence recording is unavailable",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
  });
});
