const EXACT_DECIMAL = /^(-?)(0|[1-9]\\d*)(?:\\.(\\d+))?(?:[eE]([+-]?\\d+))?$/;
const MAX_ABSOLUTE_EXPONENT = 10_000;

type ParsedDecimal = Readonly<{
  negative: boolean;
  digits: bigint;
  scale: number;
}>;

function parse(value: string): ParsedDecimal {
  const trimmed = value.trim();
  const match = EXACT_DECIMAL.exec(trimmed);
  if (match === null) {
    throw new TypeError("value must be an exact base-10 decimal.");
  }

  const whole = match[2] ?? "0";
  const fraction = match[3] ?? "";
  const exponentText = match[4] ?? "0";
  const exponentDigits = exponentText.replace(/^[+-]/, "");
  if (exponentDigits.length > 6) {
    throw new RangeError("decimal exponent is outside the supported range.");
  }

  const exponent = Number(exponentText);
  if (
    !Number.isSafeInteger(exponent) ||
    Math.abs(exponent) > MAX_ABSOLUTE_EXPONENT
  ) {
    throw new RangeError("decimal exponent is outside the supported range.");
  }

  let digits = BigInt(`${whole}${fraction}`);
  if (digits === 0n) {
    return { negative: false, digits: 0n, scale: 0 };
  }

  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (scale > MAX_ABSOLUTE_EXPONENT) {
    throw new RangeError("decimal scale is outside the supported range.");
  }

  return {
    negative: match[1] === "-",
    digits,
    scale,
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
