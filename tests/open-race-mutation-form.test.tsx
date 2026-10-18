import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionState = vi.hoisted(() => ({ state: "idle", pending: false }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState: () => [
    actionState.state,
    async () => {},
    actionState.pending,
  ],
}));
vi.mock("@/app/(private)/open-race/actions", () => ({
  lockOpenRaceSessionFormAction: async () => "confirmed",
  recordOpenRaceObservationFormAction: async () => "confirmed",
}));

import { OpenRaceMutationForm } from "@/components/open-race-mutation-form";

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
