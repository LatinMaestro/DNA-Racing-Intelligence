import { describe, expect, it } from "vitest";
import {
  canBurn,
  offspringClass,
  offspringElement,
  offspringFNumber,
} from "@/domain/game-rules";

describe("confirmed breeding and burn rules", () => {
  it("applies the class matrix symmetrically", () => {
    expect(offspringClass("Genesis", "Morphed")).toBe("Freak");
    expect(offspringClass("Morphed", "Genesis")).toBe("Freak");
    expect(offspringClass("Freak", "Morphed")).toBe("X-Class");
  });

  it("uses the lower-ranked element", () => {
    expect(offspringElement("Metal", "Fire")).toBe("Fire");
    expect(offspringElement("Earth", "Earth")).toBe("Earth");
    expect(offspringElement("Water", "Metal")).toBe("Water");
  });

  it("adds positive integer F-numbers without a cap", () => {
    expect(offspringFNumber(8, 13)).toBe(21);
    expect(() => offspringFNumber(0, 3)).toThrow(RangeError);
  });

  it("never permits a Genesis burn", () => {
    expect(canBurn("Genesis")).toBe(false);
    expect(canBurn("Morphed")).toBe(true);
  });
});
