/**
 * Configuration.
 *
 * Everything comes from the environment. The server is deliberately
 * single-tenant: one process serves exactly one Invoice4U organisation, chosen
 * here at startup and never by a tool argument, so a model cannot pick the
 * wrong company.
 */

import { Invoice4uError } from "./invoice4u/errors.js";
import { DEFAULT_KEYCHAIN_SERVICE, readKeychainSecret } from "./secrets.js";

export type Environment = "qa" | "production";
export type AuthMode = "auto" | "exchange" | "direct";
export type LogLevel = "error" | "warn" | "info" | "debug";

/** The only hosts this server will contact. There is no base-URL override. */
export const BASE_URLS: Readonly<Record<Environment, string>> = {
  qa: "https://apiqa.invoice4u.co.il/Services/ApiService.svc",
  production: "https://api.invoice4u.co.il/Services/ApiService.svc",
};

export interface Config {
  env: Environment;
  baseUrl: string;
  apiKey: string;
  /** Where the key came from, for diagnostics. Never the key itself. */
  keySource: string;
  expectOrg: string | undefined;
  allowWrites: boolean;
  authMode: AuthMode;
  logLevel: LogLevel;
  timeoutMs: number;
}

const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];
const AUTH_MODES: readonly AuthMode[] = ["auto", "exchange", "direct"];

/**
 * Claude Code leaves an unresolved `${VAR}` in place and starts the server
 * anyway, so a literal placeholder has to be caught here rather than sent to
 * the API as if it were a real value.
 */
function reject(name: string, value: string): void {
  if (/\$\{[^}]*\}/.test(value)) {
    throw new Invoice4uError({
      kind: "config_error",
      message:
        `${name} is still the literal text "${value}" — an environment variable was never ` +
        "substituted. Set it in the shell, or give it a default in .mcp.json.",
    });
  }
}

function readEnv(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = source[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "") return undefined;
  reject(name, value);
  return value;
}

export interface LoadOptions {
  /** Injectable for tests. */
  resolveSecret?: (lookup: { service: string; account: string }) => Promise<string>;
}

export async function loadConfig(
  source: NodeJS.ProcessEnv = process.env,
  options: LoadOptions = {},
): Promise<Config> {
  const problems: string[] = [];

  const envRaw = readEnv(source, "INVOICE4U_ENV");
  if (envRaw === undefined) {
    problems.push(
      "INVOICE4U_ENV is required and must be exactly \"qa\" or \"production\". " +
        "There is no default — production is never selected implicitly.",
    );
  } else if (envRaw !== "qa" && envRaw !== "production") {
    problems.push(`INVOICE4U_ENV must be "qa" or "production", got "${envRaw}".`);
  }

  const account = readEnv(source, "INVOICE4U_ACCOUNT");
  const directKey = readEnv(source, "INVOICE4U_API_KEY");
  if (account === undefined && directKey === undefined) {
    problems.push(
      "Set INVOICE4U_ACCOUNT (a Keychain label) or INVOICE4U_API_KEY (the key itself).",
    );
  }

  const authModeRaw = readEnv(source, "INVOICE4U_AUTH_MODE") ?? "auto";
  if (!AUTH_MODES.includes(authModeRaw as AuthMode)) {
    problems.push(`INVOICE4U_AUTH_MODE must be one of ${AUTH_MODES.join(", ")}.`);
  }

  const logLevelRaw = readEnv(source, "INVOICE4U_LOG_LEVEL") ?? "info";
  if (!LOG_LEVELS.includes(logLevelRaw as LogLevel)) {
    problems.push(`INVOICE4U_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}.`);
  }

  const allowWritesRaw = readEnv(source, "INVOICE4U_ALLOW_WRITES") ?? "false";
  if (allowWritesRaw !== "true" && allowWritesRaw !== "false") {
    problems.push('INVOICE4U_ALLOW_WRITES must be exactly "true" or "false".');
  }

  const timeoutRaw = readEnv(source, "INVOICE4U_TIMEOUT_MS");
  let timeoutMs = 15_000;
  if (timeoutRaw !== undefined) {
    const parsed = Number(timeoutRaw);
    if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
      problems.push("INVOICE4U_TIMEOUT_MS must be an integer between 1000 and 120000.");
    } else {
      timeoutMs = parsed;
    }
  }

  if (problems.length > 0) {
    throw new Invoice4uError({
      kind: "config_error",
      message: `Invalid configuration:\n  - ${problems.join("\n  - ")}`,
    });
  }

  const env = envRaw as Environment;
  const service = readEnv(source, "INVOICE4U_KEYCHAIN_SERVICE") ?? DEFAULT_KEYCHAIN_SERVICE;

  let apiKey: string;
  let keySource: string;
  if (account !== undefined) {
    const resolve = options.resolveSecret ?? readKeychainSecret;
    apiKey = await resolve({ service, account });
    keySource = `keychain:${service}/${account}`;
  } else {
    apiKey = directKey as string;
    keySource = "env:INVOICE4U_API_KEY";
  }

  return {
    env,
    baseUrl: BASE_URLS[env],
    apiKey,
    keySource,
    expectOrg: readEnv(source, "INVOICE4U_EXPECT_ORG"),
    allowWrites: allowWritesRaw === "true",
    authMode: authModeRaw as AuthMode,
    logLevel: logLevelRaw as LogLevel,
    timeoutMs,
  };
}
