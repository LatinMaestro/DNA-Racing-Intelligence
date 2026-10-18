import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionState = vi.hoisted(() => ({ state: "idle", pending: false }));
const actions = vi.hoisted(() => ({
  lock: vi.fn(async (): Promise<"confirmed" | "unconfirmed"> => "confirmed"),
  observation: vi.fn(
    async (): Promise<"confirmed" | "unconfirmed"> => "confirmed",
  ),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState: () => [
    actionState.state,
    async () => {},
    actionState.pending,
  ],
}));
vi.mock("@/app/(private)/open-race/actions", () => ({
  lockOpenRaceSessionFormAction: actions.lock,
  recordOpenRaceObservationFormAction: actions.observation,
}));

import {
  OpenRaceMutationForm,
  submitOpenRaceEvidence,
} from "@/components/open-race-mutation-form";

afterEach(() => {
  actionState.state = "idle";
  actionState.pending = false;
});

function render(operation: "lock" | "observation" = "lock") {
  return renderToStaticMarkup(
    <OpenRaceMutationForm operation={operation}>
      <input name="requestId" value="synthetic-request" readOnly />
    </OpenRaceMutationForm>,
  );
}

describe("Open Race write recovery", () => {
  it("keeps the initial form usable without claiming success", () => {
    const html = render();
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('<fieldset disabled=""');
    expect(html).not.toContain("saved.");
    expect(html).not.toContain("could not be confirmed");
  });

  it("disables all fields during a pending save and announces progress", () => {
    actionState.pending = true;
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('role="status"');
    expect(html).toContain("Saving evidence…");
    expect(html).not.toContain("saved.");
  });

  it("withholds success and blocks blind resubmission after an uncertain outcome", () => {
    actionState.state = "unconfirmed";
    const html = render();
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('role="alert"');
    expect(html).toContain("A write might have completed");
    expect(html).toContain('type="button"');
    expect(html).not.toContain("saved.");
  });

  it.each([
    ["lock", "Field lock saved"],
    ["observation", "Diagnostic observation saved"],
  ] as const)(
    "announces confirmed %s evidence without allowing replay",
    (operation, message) => {
      actionState.state = "confirmed";
      const html = render(operation);
      expect(html).toContain(message);
      expect(html).toContain('role="status"');
      expect(html).toContain('<fieldset disabled=""');
      expect(html).toContain("Reload and review session");
    },
  );
});

describe("Open Race browser transport recovery", () => {
  it.each(["lock", "observation"] as const)(
    "does not retry %s when the server response is lost",
    async (operation) => {
      const action = operation === "lock" ? actions.lock : actions.observation;
      action.mockClear();
      action.mockRejectedValueOnce(new Error("synthetic transport failure"));
      expect(
        await submitOpenRaceEvidence(operation, "idle", new FormData()),
      ).toBe("unconfirmed");
      expect(action).toHaveBeenCalledTimes(1);
    },
  );
});
