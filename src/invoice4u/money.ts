/**
 * Money handling.
 *
 * Every monetary total in the Invoice4U contract exists twice: a `double`
 * (`Total`) and an `xs:decimal` twin (`TotalDecimal`). The doubles drift on
 * agorot, so the decimal twin is always preferred, and money crosses the MCP
 * boundary as a decimal *string* rather than a JavaScript number.
 */

/** Pick the `*Decimal` variant when present, falling back to the double. */
export function pickDecimal(
  record: Record<string, unknown> | undefined,
  baseField: string,
): string | null {
  if (record === undefined) return null;
  const decimal = record[`${baseField}Decimal`];
  const plain = record[baseField];
  const chosen = decimal ?? plain;
  return toMoneyString(chosen);
}

/**
 * Normalize a money value to a fixed-2 decimal string.
 *
 * Strings are passed through when they already look like a decimal number, so
 * an exact server-supplied value is never round-tripped through a float.
 */
export function toMoneyString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    return normalizeDecimalString(trimmed);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value.toFixed(2);
  }

  return null;
}

/** Round a plain decimal string to 2 places without going through a float. */
function normalizeDecimalString(input: string): string {
  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [intPartRaw, fracRaw = ""] = unsigned.split(".");
  const intPart = intPartRaw ?? "0";

  if (fracRaw.length <= 2) {
    const frac = fracRaw.padEnd(2, "0");
    return `${negative ? "-" : ""}${stripLeadingZeros(intPart)}.${frac}`;
  }

  // Round half-up on the third fractional digit.
  const keep = fracRaw.slice(0, 2);
  const nextDigit = Number(fracRaw[2]);
  let cents = BigInt(stripLeadingZeros(intPart) + keep);
  if (nextDigit >= 5) cents += 1n;

  const asString = cents.toString().padStart(3, "0");
  const whole = asString.slice(0, -2);
  const frac = asString.slice(-2);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

function stripLeadingZeros(digits: string): string {
  const stripped = digits.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

/** Sum decimal strings exactly, in integer agorot. */
export function sumMoney(values: readonly (string | null)[]): string {
  let cents = 0n;
  for (const value of values) {
    if (value === null) continue;
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [whole = "0", frac = "00"] = unsigned.split(".");
    const amount = BigInt(whole + frac.padEnd(2, "0").slice(0, 2));
    cents += negative ? -amount : amount;
  }
  const negative = cents < 0n;
  const abs = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}
