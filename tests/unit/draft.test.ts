import { describe, expect, it } from "vitest";
import { buildDraft } from "../../src/invoice4u/draft.js";
import { multiplyMoney, percentOf } from "../../src/invoice4u/money.js";

describe("exact arithmetic", () => {
  it("multiplies without float drift", () => {
    expect(multiplyMoney("0.10", "3")).toBe("0.30");
    expect(multiplyMoney("11250.00", "1")).toBe("11250.00");
    expect(multiplyMoney("1.15", "3")).toBe("3.45");
    expect(multiplyMoney("99.99", "7")).toBe("699.93");
  });

  it("handles fractional quantities", () => {
    expect(multiplyMoney("100.00", "2.5")).toBe("250.00");
    expect(multiplyMoney("33.33", "0.5")).toBe("16.67"); // half-up
  });

  it("computes VAT exactly", () => {
    expect(percentOf("11250.00", "18")).toBe("2025.00");
    expect(percentOf("5625.00", "18")).toBe("1012.50");
    expect(percentOf("100.00", "0")).toBe("0.00");
    expect(percentOf("1016.95", "18")).toBe("183.05");
  });

  it("rejects values that are not numbers", () => {
    expect(() => multiplyMoney("abc", "1")).toThrow();
    expect(() => percentOf("100.00", "x")).toThrow();
  });
});

describe("buildDraft", () => {
  const base = {
    documentType: 7,
    customerId: 1957022,
    taxPercentage: "18",
    lines: [{ name: "פיתוח", quantity: "1", unitPrice: "5625.00" }],
  };

  it("computes totals from the lines rather than trusting a caller", () => {
    const built = buildDraft(base);
    expect(built.totals).toEqual({
      totalWithoutTax: "5625.00",
      totalTax: "1012.50",
      total: "6637.50",
    });
    // matches invoice-receipt #70732 on the real account
    expect(built.payload.Total).toBe(6637.5);
  });

  it("sums several lines exactly", () => {
    const built = buildDraft({
      ...base,
      lines: [
        { name: "a", quantity: "3", unitPrice: "0.10" },
        { name: "b", quantity: "1", unitPrice: "0.20" },
      ],
    });
    expect(built.totals.totalWithoutTax).toBe("0.50");
  });

  it("lets a line override the document rate, e.g. an exempt line", () => {
    const built = buildDraft({
      ...base,
      lines: [
        { name: "taxed", quantity: "1", unitPrice: "100.00" },
        { name: "exempt", quantity: "1", unitPrice: "100.00", taxPercentage: "0" },
      ],
    });
    expect(built.totals.totalTax).toBe("18.00");
    expect(built.totals.total).toBe("218.00");
  });

  it("sends the issue date in WCF form", () => {
    const built = buildDraft({ ...base, issueDate: "2026-09-23" });
    expect(built.payload.IssueDate).toBe(`/Date(${Date.UTC(2026, 8, 23)})/`);
  });

  it("omits an id when creating, so a create cannot overwrite a draft", () => {
    expect(buildDraft(base).payload.ID).toBeUndefined();
  });

  it("carries the id only when updating", () => {
    const built = buildDraft({ ...base, draftId: "abc-123" });
    expect(built.payload.ID).toBe("abc-123");
    expect(built.payload.UniqueID).toBe("abc-123");
  });

  it("refuses a draft with no lines", () => {
    expect(() => buildDraft({ ...base, lines: [] })).toThrow(/at least one line/);
  });

  it("refuses a line whose price is not a money value", () => {
    expect(() => buildDraft({ ...base, lines: [{ name: "x", quantity: "1", unitPrice: "lots" }] })).toThrow();
  });
});
