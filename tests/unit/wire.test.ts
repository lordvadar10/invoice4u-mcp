import { describe, expect, it } from "vitest";
import { fromWcfDate, toWcfDate, unwrapCollection } from "../../src/invoice4u/wire.js";

describe("collection unwrapping", () => {
  /** GetDocuments and GetCustomersByOrgId wrap rows in `Response`. */
  it("unwraps a CommonCollection Response array", () => {
    const live = {
      __type: "CommonCollectionOfArrayOfDocumentJHiVxprS:#Invoice.Common",
      Errors: [],
      Info: [],
      OpenInfo: [],
      RecaptchaToken: null,
      Response: [{ DocumentNumber: 10746 }],
    };
    expect(unwrapCollection(live)).toEqual([{ DocumentNumber: 10746 }]);
  });

  /** GetBranches answers with a bare array instead — both shapes are real. */
  it("passes a bare array through", () => {
    expect(unwrapCollection([{ ID: 1 }])).toEqual([{ ID: 1 }]);
  });

  it("yields an empty list for null or an unrecognised shape", () => {
    expect(unwrapCollection(null)).toEqual([]);
    expect(unwrapCollection({ Errors: [] })).toEqual([]);
    expect(unwrapCollection("nope")).toEqual([]);
  });
});

describe("dates", () => {
  /** An ISO string in a DocumentsRequest makes the service answer HTTP 500. */
  it("serializes requests as /Date(ms)/", () => {
    expect(toWcfDate("2026-01-01")).toBe(`/Date(${Date.UTC(2026, 0, 1)})/`);
  });

  it("extends the end of a range to the end of that day", () => {
    expect(toWcfDate("2026-12-31", true)).toBe(
      `/Date(${Date.UTC(2026, 11, 31, 23, 59, 59, 999)})/`,
    );
  });

  it("parses a /Date(ms+ZZZZ)/ response value", () => {
    expect(fromWcfDate("/Date(1737842400000+0200)/")).toBe(
      new Date(1737842400000).toISOString(),
    );
  });

  it("tolerates a plain date string", () => {
    expect(fromWcfDate("2026-09-23T00:00:00Z")).toBe("2026-09-23T00:00:00.000Z");
  });

  it("returns null for nothing", () => {
    expect(fromWcfDate("")).toBeNull();
    expect(fromWcfDate(null)).toBeNull();
  });
});
