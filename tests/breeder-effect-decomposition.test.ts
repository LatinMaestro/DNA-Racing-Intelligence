import { describe, expect, it } from "vitest";
import {
  decomposeBreederEffects,
  type BreederLiftObservation,
} from "../domain/breeder-effect-decomposition";

const scope = { mode: "bike" as const, distanceMetres: 1400 };

function outcome(
  offspringCoreId: string,
  parentA: string,
  parentB: string,
  lift: number,
): BreederLiftObservation {
  return {
    offspringCoreId,
    parentACoreId: parentA,
    parentBCoreId: parentB,
    scope,
    liftPercentilePoints: lift,
  };
}

describe("breeder-effect decomposition", () => {
  it("identifies a repeatable parent effect across different co-parents", () => {
    const observations: BreederLiftObservation[] = [
      outcome("a1", "rising", "mate-1", 30),
      outcome("a2", "rising", "mate-2", 27),
      outcome("a3", "rising", "mate-3", 24),
      outcome("a4", "rising", "mate-4", 20),
      outcome("b1", "ordinary-1", "mate-1", -10),
      outcome("b2", "ordinary-2", "mate-2", -15),
      outcome("b3", "ordinary-3", "mate-3", -12),
      outcome("b4", "ordinary-4", "mate-4", -8),
      outcome("c1", "ordinary-1", "ordinary-2", -5),
      outcome("c2", "ordinary-3", "ordinary-4", -7),
    ];

    const result = decomposeBreederEffects({ scope, observations });
    const rising = result.parentEffects.find(
      (effect) => effect.parentCoreId === "rising",
    );

    expect(rising).toBeDefined();
    expect(rising?.distinctCoParentCount).toBe(4);
    expect(rising?.adjustedBreederEffect).toBeGreaterThan(0);
    expect(rising?.effectPercentile).toBeGreaterThanOrEqual(90);
  });

  it("does not promote a one-co-parent signal to target", () => {
    const observations: BreederLiftObservation[] = [
      outcome("a1", "parent-a", "parent-b", 35),
      outcome("a2", "parent-a", "parent-b", 32),
      outcome("a3", "parent-a", "parent-b", 30),
      outcome("b1", "other-1", "other-2", -5),
      outcome("b2", "other-3", "other-4", -6),
      outcome("b3", "other-5", "other-6", -4),
    ];

    const result = decomposeBreederEffects({ scope, observations });
    const parent = result.parentEffects.find(
      (effect) => effect.parentCoreId === "parent-a",
    );

    expect(parent?.distinctCoParentCount).toBe(1);
    expect(parent?.status).not.toBe("target");
    expect(parent?.warnings.join(" ")).toMatch(/Co-parent diversity/u);
  });

  it("separates repeated pair synergy from general parent lift", () => {
    const observations: BreederLiftObservation[] = [
      outcome("pair-1", "a", "b", 35),
      outcome("pair-2", "a", "b", 33),
      outcome("pair-3", "a", "b", 31),
      outcome("a-other-1", "a", "c", -2),
      outcome("a-other-2", "a", "d", 0),
      outcome("b-other-1", "b", "e", -1),
      outcome("b-other-2", "b", "f", 1),
      outcome("background-1", "c", "d", 0),
      outcome("background-2", "e", "f", 0),
    ];

    const result = decomposeBreederEffects({ scope, observations });
    const pair = result.pairSynergies.find(
      (entry) => entry.parentACoreId === "a" && entry.parentBCoreId === "b",
    );

    expect(pair).toBeDefined();
    expect(pair?.offspringCount).toBe(3);
    expect(pair?.adjustedPairSynergy).toBeGreaterThan(0);
    expect(pair?.status).toBe("watch");
  });

  it("is invariant to parent ordering", () => {
    const left = decomposeBreederEffects({
      scope,
      observations: [
        outcome("1", "a", "b", 20),
        outcome("2", "a", "c", 10),
        outcome("3", "b", "c", -5),
      ],
    });
    const right = decomposeBreederEffects({
      scope,
      observations: [
        outcome("1", "b", "a", 20),
        outcome("2", "c", "a", 10),
        outcome("3", "c", "b", -5),
      ],
    });

    expect(right).toEqual(left);
  });

  it("downweights one extreme child rather than letting it dominate", () => {
    const result = decomposeBreederEffects({
      scope,
      observations: [
        outcome("1", "a", "x", 100),
        outcome("2", "a", "y", -5),
        outcome("3", "a", "z", -5),
        outcome("4", "b", "x", 0),
        outcome("5", "c", "y", 0),
        outcome("6", "d", "z", 0),
      ],
    });
    const parent = result.parentEffects.find(
      (effect) => effect.parentCoreId === "a",
    );

    expect(parent).toBeDefined();
    expect(parent?.positiveLiftRate).toBeCloseTo(1 / 3);
    expect(parent?.status).not.toBe("target");
  });

  it("rejects duplicate offspring within one scope", () => {
    expect(() =>
      decomposeBreederEffects({
        scope,
        observations: [
          outcome("same", "a", "b", 10),
          outcome("same", "c", "d", 20),
        ],
      }),
    ).toThrow(/Duplicate offspring/u);
  });
});
