import { describe, expect, it } from "vitest";
import { pickMoney, sumMoney, toMoneyString, usesDecimals } from "../../src/invoice4u/money.js";

describe("money", () => {
  /**
   * The trap, seen on every document in a live account on 2026-09-23:
   * TotalDecimal is 0 and UseDecimalValues is null while Total carries the
   * real amount. Preferring the decimal twin unconditionally would report
   * every invoice as 0.00.
   */
  it("ignores the *Decimal twin when UseDecimalValues is not set", () => {
    const live = { Total: 40710, TotalDecimal: 0, UseDecimalValues: null };
    expect(pickMoney(live, "Total")).toBe("40710.00");
  });

  it("uses the *Decimal twin when the document says decimals are in use", () => {
    const doc = { Total: 1234.5600000000001, TotalDecimal: "1234.56", UseDecimalValues: true };
    expect(pickMoney(doc, "Total")).toBe("1234.56");
  });

  it("lets a parent document's flag drive nested items", () => {
    const item = { Price: 34500, PriceDecimal: 0 };
    expect(pickMoney(item, "Price", false)).toBe("34500.00");
    expect(pickMoney({ Price: 1, PriceDecimal: "99.99" }, "Price", true)).toBe("99.99");
  });

  it("reads the flag off a record", () => {
    expect(usesDecimals({ UseDecimalValues: true })).toBe(true);
    expect(usesDecimals({ UseDecimalValues: null })).toBe(false);
    expect(usesDecimals(undefined)).toBe(false);
  });

  it("returns null for a missing field", () => {
    expect(pickMoney({}, "Total")).toBeNull();
    expect(pickMoney(undefined, "Total")).toBeNull();
  });

  it("normalizes to two places", () => {
    expect(toMoneyString("5")).toBe("5.00");
    expect(toMoneyString("5.1")).toBe("5.10");
    expect(toMoneyString("-3.456")).toBe("-3.46");
    expect(toMoneyString("0.005")).toBe("0.01");
    expect(toMoneyString(40710)).toBe("40710.00");
  });

  it("rejects values that are not decimal numbers", () => {
    expect(toMoneyString("abc")).toBeNull();
    expect(toMoneyString(Number.NaN)).toBeNull();
    expect(toMoneyString(null)).toBeNull();
  });

  it("sums exactly, without float drift", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["1234.56", "-234.56"])).toBe("1000.00");
    expect(sumMoney([])).toBe("0.00");
  });
});
