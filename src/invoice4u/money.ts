/**
 * Money handling.
 *
 * Every monetary total in the contract exists twice: a `double` (`Total`) and
 * an `xs:decimal` twin (`TotalDecimal`). The obvious move is to always prefer
 * the decimal — and it is wrong.
 *
 * Verified against live production data on 2026-09-23: across every document
 * in a real account, `UseDecimalValues` was null and every `*Decimal` field
 * was 0 while the plain field carried the real amount. Blindly preferring the
 * decimal twin reports every total as 0.00.
 *
 * So the decimal twin is used only when the document says it is in use.
 * Money still crosses the MCP boundary as a decimal string, never a float.
 */

/** True when this record's `*Decimal` fields are the authoritative ones. */
export function usesDecimals(record: Record<string, unknown> | undefined): boolean {
  return record?.UseDecimalValues === true;
}

/**
 * Read a money field, honouring `UseDecimalValues`.
 *
 * `useDecimal` is passed explicitly for nested records (items, payments),
 * which carry the decimal twins but not the flag — the flag lives on the
 * parent document.
 */
export function pickMoney(
  record: Record<string, unknown> | undefined,
  baseField: string,
  useDecimal?: boolean,
): string | null {
  if (record === undefined) return null;
  const preferDecimal = useDecimal ?? usesDecimals(record);
  const chosen = preferDecimal ? (record[`${baseField}Decimal`] ?? record[baseField]) : record[baseField];
  return toMoneyString(chosen);
}

/**
 * Normalize a money value to a fixed-2 decimal string.
 *
 * Strings that already look like decimals are rounded textually, so an exact
 * server-supplied value never round-trips through a float.
 */
export function toMoneyString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    return normalizeDecimalString(trimmed);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? normalizeDecimalString(value.toString()) : null;
  }

  return null;
}

function normalizeDecimalString(input: string): string {
  if (input.includes("e") || input.includes("E")) return Number(input).toFixed(2);

  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [intPartRaw, fracRaw = ""] = unsigned.split(".");
  const intPart = stripLeadingZeros(intPartRaw ?? "0");

  if (fracRaw.length <= 2) {
    return `${negative ? "-" : ""}${intPart}.${fracRaw.padEnd(2, "0")}`;
  }

  // Round half-up on the third fractional digit, in integer agorot.
  let cents = BigInt(intPart + fracRaw.slice(0, 2));
  if (Number(fracRaw[2]) >= 5) cents += 1n;

  const digits = cents.toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
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
  const digits = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
