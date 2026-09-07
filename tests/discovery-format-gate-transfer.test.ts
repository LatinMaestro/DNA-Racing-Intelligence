import { describe, expect, it } from "vitest";
import {
  inferDiscoveryFormatGateTransferFit,
  type DiscoveryFormatGateBenchmarkProfile,
} from "@/domain/discovery-format-gate-transfer";
import type { ProbeMode } from "@/domain/discovery-probe-plan";

function benchmark(
  mode: ProbeMode = "bike",
  overrides: Partial<DiscoveryFormatGateBenchmarkProfile> = {},
): DiscoveryFormatGateBenchmarkProfile {
  return {
    mode,
    distanceMetres: 1_600,
    formatId: "6_gate_madness",
    gateCount: 6,
    benchmarkCoreCount: 60,
    eliteCohortPercentileFloor: 0.9,
    eliteCohortRankingMetric: "top_three_outcome",
    centralSpeedMetresPerSecond: {
      p25: 16.9,
      median: 17.0,
      p75: 17.1,
    },
    ceilingSpeedMetresPerSecond: {
      p25: 17.2,
      median: 17.35,
      p75: 17.5,
    },
    dispersion: {
      kind: "coefficient_of_variation",
      p25: 0.012,
      median: 0.02,
      p75: 0.03,
    },
    dataCurrentThrough: "2026-09-07T00:00:00.000Z",
    sourceAuthority: "synthetic exact-format benchmark fixture",
    ...overrides,
  };
}

describe("Discovery format/gate transfer inference", () => {
  it("prioritises an untested Core whose central, ceiling and dispersion match an elite format cohort", () => {
    const result = inferDiscoveryFormatGateTransferFit({
      mode: "bike",
      distanceMetres: 1_600,
      formatId: "6_gate_madness",
      gateCount: 6,
      usableDistanceObservationCount: 14,
      centralSpeedMetresPerSecond: 17.02,
      ceilingSpeedMetresPerSecond: 17.4,
      dispersion: {
        kind: "coefficient_of_variation",
        value: 0.021,
      },
      directFormatRaceCount: 0,
      benchmark: benchmark(),
    });

    expect(result.assessment).toBe("strong_inferred_fit");
    expect(result.centralPaceFit).toBe("matches_or_betters_elite_median");
    expect(result.ceilingPaceFit).toBe("matches_or_betters_elite_median");
    expect(result.dispersionFit).toBe("within_elite_cohort");
    expect(result.confidence).toBe("high");
    expect(result.recommendedAction).toBe("targeted_format_probe");
    expect(result.inferenceOnly).toBe(true);
    expect(result.provenFormatSpecialist).toBe(false);
  });

  it("identifies a volatile ceiling candidate even when its median is below the elite cohort", () => {
    const result = inferDiscoveryFormatGateTransferFit({
      mode: "bike",
      distanceMetres: 1_600,
      formatId: "6_gate_madness",
      gateCount: 6,
      usableDistanceObservationCount: 12,
      centralSpeedMetresPerSecond: 16.82,
      ceilingSpeedMetresPerSecond: 17.42,
      dispersion: {
        kind: "coefficient_of_variation",
        value: 0.035,
      },
      directFormatRaceCount: 0,
      benchmark: benchmark(),
    });

    expect(result.assessment).toBe("ceiling_inferred_fit");
    expect(result.centralPaceFit).toBe("below_elite_lower_quartile");
    expect(result.ceilingPaceFit).toBe("matches_or_betters_elite_median");
    expect(result.dispersionFit).toBe("wider_than_elite_cohort");
    expect(result.recommendedAction).toBe("targeted_format_probe");
    expect(result.reasons).toContain("wider_than_elite_format_cohort");
  });

  it("does not let transfer inference override a useful direct format sample", () => {
    const result = inferDiscoveryFormatGateTransferFit({
      mode: "bike",
      distanceMetres: 1_600,
      formatId: "6_gate_madness",
      gateCount: 6,
      usableDistanceObservationCount: 16,
      centralSpeedMetresPerSecond: 17.03,
      ceilingSpeedMetresPerSecond: 17.41,
      dispersion: {
        kind: "coefficient_of_variation",
        value: 0.018,
      },
      directFormatRaceCount: 5,
      benchmark: benchmark(),
    });

    expect(result.assessment).toBe("strong_inferred_fit");
    expect(result.recommendedAction).toBe("prefer_direct_format_evidence");
    expect(result.reasons).toContain("direct_format_sample_available");
    expect(result.provenFormatSpecialist).toBe(false);
  });

  it("keeps low-count elite-looking transfer evidence discoverable with low confidence", () => {
    const result = inferDiscoveryFormatGateTransferFit({
      mode: "bike",
      distanceMetres: 1_600,
      formatId: "6_gate_madness",
      gateCount: 6,
      usableDistanceObservationCount: 3,
      centralSpeedMetresPerSecond: 16.95,
      ceilingSpeedMetresPerSecond: 17.38,
      dispersion: {
        kind: "coefficient_of_variation",
        value: 0.024,
      },
      directFormatRaceCount: 0,
      benchmark: benchmark("bike", { benchmarkCoreCount: 15 }),
    });

    expect(result.assessment).toBe("strong_inferred_fit");
    expect(result.confidence).toBe("low");
    expect(result.recommendedAction).toBe("targeted_format_probe");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "distance_sample_small",
        "benchmark_sample_small",
      ]),
    );
  });

  it("does not prioritise a format when neither central nor ceiling pace reaches the elite cohort", () => {
    const result = inferDiscoveryFormatGateTransferFit({
      mode: "bike",
      distanceMetres: 1_600,
      formatId: "6_gate_madness",
      gateCount: 6,
      usableDistanceObservationCount: 15,
      centralSpeedMetresPerSecond: 16.7,
      ceilingSpeedMetresPerSecond: 17.0,
      dispersion: {
        kind: "coefficient_of_variation",
        value: 0.018,
      },
      directFormatRaceCount: 0,
      benchmark: benchmark(),
    });

    expect(result.assessment).toBe("mismatch");
    expect(result.recommendedAction).toBe(
      "do_not_prioritise_from_transfer_alone",
    );
  });

  it("supports a normalized range proxy but refuses to compare unlike dispersion metrics", () => {
    const rangeBenchmark = benchmark("bike", {
      dispersion: {
        kind: "normalized_range_proxy",
        p25: 0.04,
        median: 0.06,
        p75: 0.09,
      },
    });

    const result = inferDiscoveryFormatGateTransferFit({
      mode: "bike",
      distanceMetres: 1_600,
      formatId: "6_gate_madness",
      gateCount: 6,
      usableDistanceObservationCount: 11,
      centralSpeedMetresPerSecond: 17.0,
      ceilingSpeedMetresPerSecond: 17.35,
      dispersion: {
        kind: "normalized_range_proxy",
        value: 0.07,
      },
      directFormatRaceCount: 0,
      benchmark: rangeBenchmark,
    });

    expect(result.dispersionFit).toBe("within_elite_cohort");

    expect(() =>
      inferDiscoveryFormatGateTransferFit({
        mode: "bike",
        distanceMetres: 1_600,
        formatId: "6_gate_madness",
        gateCount: 6,
        usableDistanceObservationCount: 11,
        centralSpeedMetresPerSecond: 17.0,
        ceilingSpeedMetresPerSecond: 17.35,
        dispersion: {
          kind: "coefficient_of_variation",
          value: 0.02,
        },
        directFormatRaceCount: 0,
        benchmark: rangeBenchmark,
      }),
    ).toThrow(
      "Candidate and format-gate benchmark dispersion metrics must match.",
    );
  });

  it("applies identically to Horse and Car while keeping format authority mode-specific", () => {
    for (const mode of ["horse", "car"] as const) {
      const result = inferDiscoveryFormatGateTransferFit({
        mode,
        distanceMetres: 1_600,
        formatId: `${mode}_configured_format`,
        gateCount: 8,
        usableDistanceObservationCount: 10,
        centralSpeedMetresPerSecond: 17.02,
        ceilingSpeedMetresPerSecond: 17.4,
        dispersion: null,
        directFormatRaceCount: 0,
        benchmark: benchmark(mode, {
          formatId: `${mode}_configured_format`,
          gateCount: 8,
          dispersion: null,
          sourceAuthority: `${mode} synthetic authority`,
        }),
      });

      expect(result.mode).toBe(mode);
      expect(result.assessment).toBe("strong_inferred_fit");
      expect(result.recommendedAction).toBe("targeted_format_probe");
    }
  });

  it("requires candidate and benchmark to match mode, distance, format and gate count", () => {
    expect(() =>
      inferDiscoveryFormatGateTransferFit({
        mode: "bike",
        distanceMetres: 1_600,
        formatId: "1v1",
        gateCount: 2,
        usableDistanceObservationCount: 12,
        centralSpeedMetresPerSecond: 17.0,
        ceilingSpeedMetresPerSecond: 17.4,
        dispersion: null,
        directFormatRaceCount: 0,
        benchmark: benchmark(),
      }),
    ).toThrow(
      "Format-gate benchmark does not match the candidate mode, distance, format and gate count.",
    );
  });
});
