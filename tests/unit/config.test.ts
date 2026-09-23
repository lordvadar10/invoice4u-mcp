import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const resolveSecret = async () => "test-key";

describe("loadConfig", () => {
  it("requires INVOICE4U_ENV with no implicit production", async () => {
    await expect(
      loadConfig({ INVOICE4U_ACCOUNT: "x" }, { resolveSecret }),
    ).rejects.toThrow(/INVOICE4U_ENV is required/);
  });

  it("requires a key source", async () => {
    await expect(loadConfig({ INVOICE4U_ENV: "qa" }, { resolveSecret })).rejects.toThrow(
      /INVOICE4U_ACCOUNT .* or INVOICE4U_API_KEY/,
    );
  });

  it("catches an unexpanded ${VAR} placeholder", async () => {
    await expect(
      loadConfig(
        { INVOICE4U_ENV: "qa", INVOICE4U_ACCOUNT: "${INVOICE4U_ACCOUNT}" },
        { resolveSecret },
      ),
    ).rejects.toThrow(/was never substituted/);
  });

  it("defaults writes to off", async () => {
    const config = await loadConfig(
      { INVOICE4U_ENV: "qa", INVOICE4U_API_KEY: "k" },
      { resolveSecret },
    );
    expect(config.allowWrites).toBe(false);
    expect(config.authMode).toBe("auto");
  });

  it("only accepts exactly \"true\" to enable writes", async () => {
    await expect(
      loadConfig(
        { INVOICE4U_ENV: "qa", INVOICE4U_API_KEY: "k", INVOICE4U_ALLOW_WRITES: "yes" },
        { resolveSecret },
      ),
    ).rejects.toThrow(/must be exactly "true" or "false"/);
  });

  it("maps environments to the two allowlisted hosts", async () => {
    const qa = await loadConfig({ INVOICE4U_ENV: "qa", INVOICE4U_API_KEY: "k" }, { resolveSecret });
    expect(qa.baseUrl).toBe("https://apiqa.invoice4u.co.il/Services/ApiService.svc");

    const prod = await loadConfig(
      { INVOICE4U_ENV: "production", INVOICE4U_API_KEY: "k" },
      { resolveSecret },
    );
    expect(prod.baseUrl).toBe("https://api.invoice4u.co.il/Services/ApiService.svc");
  });

  it("reads the key from the keychain when an account is given", async () => {
    const config = await loadConfig(
      { INVOICE4U_ENV: "qa", INVOICE4U_ACCOUNT: "my-business" },
      { resolveSecret: async ({ service, account }) => `${service}:${account}` },
    );
    expect(config.apiKey).toBe("invoice4u:my-business");
    expect(config.keySource).toBe("keychain:invoice4u/my-business");
  });
});
