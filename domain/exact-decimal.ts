const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

type ParsedDecimal = Readonly<{
  negative: boolean;
  digits: bigint;
  scale: number;
}>;

function parse(value: string): ParsedDecimal {
  const trimmed = value.trim();
  if (!PLAIN_DECIMAL.test(trimmed)) {
    throw new TypeError("value must be a plain base-10 decimal.");
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    negative,
    digits: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function format(parsed: ParsedDecimal): string {
  if (parsed.digits === 0n) return "0";

  const raw = parsed.digits.toString().padStart(parsed.scale + 1, "0");
  const whole =
    parsed.scale === 0
      ? raw
      : raw.slice(0, Math.max(1, raw.length - parsed.scale));
  const fraction =
    parsed.scale === 0
      ? ""
      : raw.slice(raw.length - parsed.scale).replace(/0+$/, "");
  const unsigned = fraction ? `${whole}.${fraction}` : whole;
  return parsed.negative ? `-${unsigned}` : unsigned;
}

export function normalizeExactDecimal(value: string): string {
  return format(parse(value));
}

export function isNegativeExactDecimal(value: string): boolean {
  const parsed = parse(value);
  return parsed.negative && parsed.digits !== 0n;
}

export function isZeroExactDecimal(value: string): boolean {
  return parse(value).digits === 0n;
}

export function negateExactDecimal(value: string): string {
  const parsed = parse(value);
  return format({ ...parsed, negative: !parsed.negative });
}

export function multiplyExactDecimals(left: string, right: string): string {
  const leftParsed = parse(left);
  const rightParsed = parse(right);
  return format({
    negative: leftParsed.negative !== rightParsed.negative,
    digits: leftParsed.digits * rightParsed.digits,
    scale: leftParsed.scale + rightParsed.scale,
  });
}
