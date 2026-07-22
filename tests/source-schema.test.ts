import { describe, expect, it } from "vitest";
import {
  detectSourceEncoding,
  redactSourceSchemaSummary,
  stageSourceHeader,
} from "@/domain/source-schema";

const utf8 = (value: string) => new TextEncoder().encode(value);

describe("Phase 1 source schema staging", () => {
  it("detects the Race Merge schema from headers", () => {
    const staged = stageSourceHeader({
      headerBytes: utf8(
        "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time\n",
      ),
    });

    expect(staged).toMatchObject({
      status: "ready",
      sourceType: "race_merge",
      schemaVersion: "race-merge/v1",
      encoding: "utf_8",
    });
  });

  it("treats legacy bikeid as a cross-mode Core Details alias", () => {
    const staged = stageSourceHeader({
      headerBytes: utf8(
        "bikeid,core_name,core_type,gender,f_no,element,father_id,mother_id\n",
      ),
    });

    expect(staged).toMatchObject({
      status: "ready",
      sourceType: "core_details",
      schemaVersion: "core-details/v1",
    });
    expect(staged.columns[0]).toMatchObject({ canonicalColumn: "core_id" });
  });

  it("distinguishes Current Vault and Current Arena snapshots", () => {
    expect(
      stageSourceHeader({
        headerBytes: utf8("core_name,f_no,core_type,element,gender,me\n"),
      }).sourceType,
    ).toBe("current_vault");
    expect(
      stageSourceHeader({
        headerBytes: utf8("token_id,price_usd\n"),
      }).sourceType,
    ).toBe("current_arena");
  });

  it("quarantines an explicit source selection that contradicts the headers", () => {
    const staged = stageSourceHeader({
      headerBytes: utf8("token_id,price_usd\n"),
      selectedSourceType: "current_vault",
    });

    expect(staged.status).toBe("quarantined");
    expect(staged.issues.map(({ code }) => code)).toContain(
      "SOURCE_SELECTION_MISMATCH",
    );
  });

  it("quarantines duplicate canonical columns instead of choosing silently", () => {
    const staged = stageSourceHeader({
      headerBytes: utf8(
        "bikeid,core_id,core_name,core_type,gender,f_no,element\n",
      ),
      selectedSourceType: "core_details",
    });

    expect(staged.status).toBe("quarantined");
    expect(staged.issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_CANONICAL_COLUMN" }),
    );
  });

  it("quarantines ambiguous combined header sets without explicit selection", () => {
    const staged = stageSourceHeader({
      headerBytes: utf8(
        "core_name,f_no,core_type,element,gender,me,token_id,price_usd\n",
      ),
    });

    expect(staged).toMatchObject({
      status: "quarantined",
      sourceType: null,
    });
    expect(staged.issues[0]?.code).toBe("AMBIGUOUS_SCHEMA");
  });

  it("records legacy encoding without treating unsupported controls as text", () => {
    expect(
      detectSourceEncoding(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])),
    ).toBe("windows_1252");
    expect(detectSourceEncoding(Uint8Array.from([0x61, 0, 0x62]))).toBe(
      "unknown",
    );

    const staged = stageSourceHeader({
      headerBytes: utf8("core_name,f_no,core_type,element,gender,me\n"),
      encodingProbeBytes: Uint8Array.from([0x63, 0x61, 0x66, 0xe9]),
    });
    expect(staged.encoding).toBe("windows_1252");
  });

  it("rejects malformed CSV headers", () => {
    const staged = stageSourceHeader({
      headerBytes: utf8('"token_id,price_usd\n'),
    });
    expect(staged).toMatchObject({ status: "quarantined" });
    expect(staged.issues[0]?.code).toBe("MALFORMED_HEADER");
  });

  it("produces count-only summaries without source headers", () => {
    const privateMarker = "private-core-column";
    const staged = stageSourceHeader({
      headerBytes: utf8(`token_id,price_usd,${privateMarker}\n`),
      selectedSourceType: "current_arena",
    });
    const serialized = JSON.stringify(redactSourceSchemaSummary(staged));

    expect(serialized).not.toContain(privateMarker);
    expect(redactSourceSchemaSummary(staged)).toMatchObject({
      headerCount: 3,
      recognizedColumnCount: 2,
      unknownColumnCount: 1,
      issueCodes: ["UNKNOWN_COLUMNS"],
    });
  });
});
