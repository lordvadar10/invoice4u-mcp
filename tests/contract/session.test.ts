import { describe, expect, it, vi } from "vitest";
import { connect } from "../../src/invoice4u/session.js";
import type { Config } from "../../src/config.js";
import { createLogger } from "../../src/log.js";

const log = createLogger("error");

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    env: "qa",
    baseUrl: "https://apiqa.invoice4u.co.il/Services/ApiService.svc",
    apiKey: "key",
    keySource: "keychain:invoice4u/my-business",
    expectOrg: undefined,
    allowWrites: false,
    authMode: "direct",
    logLevel: "error",
    timeoutMs: 15_000,
    ...overrides,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** The core safety property: a key for the wrong company must not serve tools. */
describe("connect — organisation assertion", () => {
  it("starts when the organisation matches", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ d: { OrganizationUniqueId: "123456789", CompanyName: "Example Business Ltd", OrganizationID: 99001, Errors: [] } }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const connection = await connect(baseConfig({ expectOrg: "123456789" }), log);
    expect(connection.org.label).toBe("Example Business Ltd");
    expect(connection.authMode).toBe("direct");

    vi.unstubAllGlobals();
  });

  it("refuses to start when the key opens a different organisation", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ d: { OrganizationUniqueId: "999999999", CompanyName: "Some Other Business", Errors: [] } }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(connect(baseConfig({ expectOrg: "123456789" }), log)).rejects.toThrow(
      /Organisation mismatch/,
    );

    vi.unstubAllGlobals();
  });

  it("names both the expectation and what was actually opened", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ d: { OrganizationUniqueId: "999999999", CompanyName: "Some Other Business", Errors: [] } }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(connect(baseConfig({ expectOrg: "123456789" }), log)).rejects.toThrow(
      /Some Other Business/,
    );

    vi.unstubAllGlobals();
  });

  it("matches on any identifier field, since the authoritative one is unconfirmed", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ d: { OrganizationID: 4242, CompanyName: "Second Business Ltd", Errors: [] } }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const connection = await connect(baseConfig({ expectOrg: "4242" }), log);
    expect(connection.org.label).toBe("Second Business Ltd");

    vi.unstubAllGlobals();
  });

  it("serves without assertion when no expectation is configured", async () => {
    const fetchImpl = vi.fn(async () => json({ d: { CompanyName: "Whatever Ltd", Errors: [] } }));
    vi.stubGlobal("fetch", fetchImpl);

    const connection = await connect(baseConfig(), log);
    expect(connection.org.label).toBe("Whatever Ltd");

    vi.unstubAllGlobals();
  });
});
