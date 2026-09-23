import { describe, expect, it } from "vitest";
import { collectErrors, unwrapEnvelope } from "../../src/invoice4u/client.js";
import { Invoice4uError } from "../../src/invoice4u/errors.js";

/**
 * These fixtures are verbatim from live production responses captured on
 * 2026-09-23. The envelope shape is the single most important thing to get
 * right, so it is pinned here rather than described.
 */
describe("unwrapEnvelope", () => {
  it("unwraps the d envelope", () => {
    expect(unwrapEnvelope("GetThing", { d: { Value: 1 } })).toEqual({ Value: 1 });
  });

  it("rejects a <Op>Result envelope, which this API does not use", () => {
    expect(() => unwrapEnvelope("GetDocuments", { GetDocumentsResult: [] })).toThrow(
      /no "d" envelope key/,
    );
  });

  it("treats HTTP 200 with a non-empty Errors array as a failure", () => {
    const live = {
      d: {
        __type: "Tax:#Invoice.Common",
        Errors: [
          { __type: "CommonError:#Invoice.Common", Error: "UnauthorizedUser", ID: 80, Paramters: null },
        ],
        Info: [],
        OpenInfo: [],
        RecaptchaToken: null,
        TaxRate: -1,
      },
    };
    expect(() => unwrapEnvelope("GetTaxRate", live)).toThrowError(Invoice4uError);
    try {
      unwrapEnvelope("GetTaxRate", live);
    } catch (error) {
      expect((error as Invoice4uError).kind).toBe("unauthorized");
      expect((error as Invoice4uError).apiErrors[0]?.ID).toBe(80);
    }
  });

  it("treats a bare error string as a failure", () => {
    expect(() => unwrapEnvelope("GetExpDateByApiKey", { d: "UnauthorizedUser" })).toThrowError(
      Invoice4uError,
    );
  });

  it("passes a bare non-error string through", () => {
    expect(unwrapEnvelope("GetExpDateByApiKey", { d: "2027-01-01" })).toBe("2027-01-01");
  });

  it("allows null results", () => {
    expect(unwrapEnvelope("IsAuthenticated", { d: null })).toBeNull();
  });

  it("allows an empty Errors array", () => {
    expect(unwrapEnvelope("GetBranches", { d: { Errors: [], Items: [] } })).toEqual({
      Errors: [],
      Items: [],
    });
  });

  it("finds errors at the top level as well as inside the result", () => {
    expect(collectErrors({ Errors: [{ ID: 1, Error: "A" }] }, { Errors: [{ ID: 2, Error: "B" }] }))
      .toHaveLength(2);
  });

  it("de-duplicates identical errors", () => {
    const one = { Errors: [{ ID: 80, Error: "UnauthorizedUser" }] };
    expect(collectErrors(one, one)).toHaveLength(1);
  });
});
