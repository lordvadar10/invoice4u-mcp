import { describe, expect, it } from "vitest";
import { pickDecimal, sumMoney, toMoneyString } from "../../src/invoice4u/money.js";

describe("money", () => {
  it("prefers the *Decimal twin over the float", () => {
    expect(pickDecimal({ Total: 1234.5600000000001, TotalDecimal: "1234.56" }, "Total")).toBe(
      "1234.56",
    );
  });

  it("falls back to the float when no decimal twin exists", () => {
    expect(pickDecimal({ Total: 100 }, "Total")).toBe("100.00");
  });

  it("returns null for a missing field", () => {
    expect(pickDecimal({}, "Total")).toBeNull();
    expect(pickDecimal(undefined, "Total")).toBeNull();
  });

  it("normalizes to two places", () => {
    expect(toMoneyString("5")).toBe("5.00");
    expect(toMoneyString("5.1")).toBe("5.10");
    expect(toMoneyString("-3.456")).toBe("-3.46");
    expect(toMoneyString("0.005")).toBe("0.01");
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
