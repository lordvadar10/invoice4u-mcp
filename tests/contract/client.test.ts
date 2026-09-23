import { describe, expect, it, vi } from "vitest";
import { Invoice4uClient, MAX_READ_RETRIES } from "../../src/invoice4u/client.js";
import { Invoice4uError } from "../../src/invoice4u/errors.js";

const BASE = "https://apiqa.invoice4u.co.il/Services/ApiService.svc";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Invoice4uClient", () => {
  it("POSTs to the bare /{Operation} path with the token in the body", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ d: { TaxRate: 18 } }),
    );
    const client = new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });

    await client.call("GetTaxRate", { date: "2026-09-23" }, { token: "tok" });

    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe(`${BASE}/GetTaxRate`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ date: "2026-09-23", token: "tok" });
  });

  it("never puts the token in the URL", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ d: true }));
    const client = new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });
    await client.call("IsAuthenticated", {}, { token: "super-secret-key" });
    expect(fetchImpl.mock.calls[0]?.[0]).not.toContain("super-secret-key");
  });

  it("retries a read on a 5xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ d: [] }));
    const client = new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });

    await expect(client.call("GetDocuments", {}, { token: "t" })).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    const client = new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });

    await expect(client.call("GetDocuments", {}, { token: "t" })).rejects.toThrowError(
      Invoice4uError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_READ_RETRIES + 1);
  });

  it("never retries a write, so a timeout cannot duplicate a document", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    const client = new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });

    await expect(
      client.call("CreateDocumentWithIdentifierValidation", {}, { token: "t" }),
    ).rejects.toThrowError(Invoice4uError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a business failure returned as HTTP 200", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ d: { Errors: [{ ID: 80, Error: "UnauthorizedUser" }] } }),
    );
    const client = new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });

    await expect(client.call("GetTaxRate", {}, { token: "t" })).rejects.toThrowError(
      Invoice4uError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("explains an HTML response, which means a wrong operation path", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html><title>Service</title></html>", { status: 200 }),
    );
    const client = new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });

    await expect(client.call("GetTaxRate", {}, { token: "t" })).rejects.toThrow(/got HTML/);
  });

  it("redacts the API key from transport errors", async () => {
    const secret = "sk-live-abcdef123456";
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect failed using key ${secret}`);
    });
    const client = new Invoice4uClient({
      baseUrl: BASE,
      fetchImpl: fetchImpl as never,
      secrets: [secret],
    });

    await expect(client.call("GetTaxRate", {}, { token: secret })).rejects.toThrow(/«redacted»/);
    await expect(client.call("GetTaxRate", {}, { token: secret })).rejects.not.toThrow(
      new RegExp(secret),
    );
  });
});
