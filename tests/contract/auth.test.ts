import { describe, expect, it, vi } from "vitest";
import { authenticate } from "../../src/invoice4u/auth.js";
import { Invoice4uClient } from "../../src/invoice4u/client.js";
import { createLogger } from "../../src/log.js";

const BASE = "https://apiqa.invoice4u.co.il/Services/ApiService.svc";
const log = createLogger("error");

function client(fetchImpl: unknown): Invoice4uClient {
  return new Invoice4uClient({ baseUrl: BASE, fetchImpl: fetchImpl as never });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The public documentation does not say whether an API key is itself a session
 * token. `auto` therefore probes rather than assumes, and these tests pin both
 * outcomes.
 */
describe("authenticate", () => {
  /**
   * IsAuthenticated returns a User object, not a boolean — confirmed live on
   * 2026-09-23. An earlier version of this probe tested `result === true` and
   * therefore always fell through to the exchange.
   */
  it("auto: uses the key directly when IsAuthenticated returns a user", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ d: { __type: "User:#Invoice.Common", Errors: [], ID: 99001, CompanyName: "X" } }),
    );
    const session = await authenticate(client(fetchImpl), "key", "auto", log);

    expect(session).toEqual({ token: "key", mode: "direct" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("auto: an expired account is surfaced, not papered over by the exchange", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ d: { Errors: [{ ID: 66, Error: "ExpiredAccount" }] } }),
    );
    await expect(authenticate(client(fetchImpl), "key", "auto", log)).rejects.toThrow(
      /ExpiredAccount/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("auto: falls back to VerifyLoginApiKey when the key is rejected", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ d: { Errors: [{ ID: 80, Error: "UnauthorizedUser" }] } }))
      .mockResolvedValueOnce(json({ d: "session-token" }));

    const session = await authenticate(client(fetchImpl), "key", "auto", log);

    expect(session).toEqual({ token: "session-token", mode: "exchange" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("auto: treats a null IsAuthenticated result as a rejection", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ d: null }))
      .mockResolvedValueOnce(json({ d: "session-token" }));

    const session = await authenticate(client(fetchImpl), "key", "auto", log);
    expect(session.mode).toBe("exchange");
  });

  it("exchange: skips the probe entirely", async () => {
    const fetchImpl = vi.fn(async () => json({ d: "session-token" }));
    const session = await authenticate(client(fetchImpl), "key", "exchange", log);

    expect(session).toEqual({ token: "session-token", mode: "exchange" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("direct: makes no network call at all", async () => {
    const fetchImpl = vi.fn();
    const session = await authenticate(client(fetchImpl), "key", "direct", log);

    expect(session).toEqual({ token: "key", mode: "direct" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("extracts a token from an object result", async () => {
    const fetchImpl = vi.fn(async () => json({ d: { Token: "tok-from-object", Errors: [] } }));
    const session = await authenticate(client(fetchImpl), "key", "exchange", log);
    expect(session.token).toBe("tok-from-object");
  });

  it("fails loudly when the exchange returns nothing usable", async () => {
    const fetchImpl = vi.fn(async () => json({ d: { Errors: [] } }));
    await expect(authenticate(client(fetchImpl), "key", "exchange", log)).rejects.toThrow(
      /no recognisable token/,
    );
  });
});
