import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPE,
  documentStatusName,
  documentTypeName,
  paymentTypeName,
} from "../../src/invoice4u/enums.js";

describe("enums", () => {
  it("matches the WSDL EnumerationValue codes", () => {
    expect(DOCUMENT_TYPE.invoice).toBe(1);
    expect(DOCUMENT_TYPE.receipt).toBe(2);
    expect(DOCUMENT_TYPE.invoice_receipt).toBe(3);
    expect(DOCUMENT_TYPE.credit_invoice).toBe(4);
  });

  it("keeps the gap: purchase_order is 13, not 11", () => {
    expect(DOCUMENT_TYPE.purchase_order).toBe(13);
    expect(Object.values(DOCUMENT_TYPE)).not.toContain(11);
    expect(Object.values(DOCUMENT_TYPE)).not.toContain(12);
  });

  it("reports unknown codes rather than inventing a name", () => {
    expect(documentTypeName(11)).toBe("unknown_type_11");
    expect(paymentTypeName(99)).toBe("unknown_payment_type_99");
  });

  it("names the three statuses confirmed against live data", () => {
    expect(documentStatusName(1)).toEqual({ code: 1, name: "open" });
    expect(documentStatusName(2)).toEqual({ code: 2, name: "closed" });
    expect(documentStatusName(3)).toEqual({ code: 3, name: "credited" });
  });

  it("passes the API's own Hebrew status string through", () => {
    expect(documentStatusName(2, "סגורה")).toEqual({ code: 2, name: "closed", label: "סגורה" });
  });

  it("reports an unconfirmed code as a bare number rather than guessing", () => {
    expect(documentStatusName(9)).toEqual({ code: 9 });
    expect(documentStatusName(9, "משהו")).toEqual({ code: 9, label: "משהו" });
    expect(documentStatusName(undefined)).toEqual({ code: null });
  });
});
