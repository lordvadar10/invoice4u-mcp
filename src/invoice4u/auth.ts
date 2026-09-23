/**
 * Authentication.
 *
 * The contract offers two plausible routes and the public documentation does
 * not say which one an API key takes:
 *
 *   direct   — the API key IS the session token, passed as `token`.
 *   exchange — VerifyLoginApiKey(apiKey) returns a token, used from then on.
 *
 * `auto` settles it at runtime: try the key directly against IsAuthenticated,
 * and fall back to the exchange. The winning route is reported by
 * `verify_connection` so the answer is observed rather than assumed.
 */

import type { AuthMode } from "../config.js";
import type { Logger } from "../log.js";
import type { Invoice4uClient } from "./client.js";
import { Invoice4uError } from "./errors.js";

export type ResolvedAuthMode = "direct" | "exchange";

export interface Session {
  token: string;
  mode: ResolvedAuthMode;
}

/** True when the API accepts this token for authenticated calls. */
async function tokenWorks(client: Invoice4uClient, token: string): Promise<boolean> {
  try {
    const result = await client.call<unknown>("IsAuthenticated", {}, { token });
    return result === true;
  } catch (error) {
    if (error instanceof Invoice4uError && error.kind === "unauthorized") return false;
    if (error instanceof Invoice4uError && error.kind === "api_error") return false;
    throw error;
  }
}

async function exchange(client: Invoice4uClient, apiKey: string): Promise<string> {
  const result = await client.call<unknown>("VerifyLoginApiKey", { apiKey });

  if (typeof result === "string" && result !== "") return result;
  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>;
    for (const field of ["Token", "token", "SessionId", "UniqueID"]) {
      const value = record[field];
      if (typeof value === "string" && value !== "") return value;
    }
  }

  throw new Invoice4uError({
    kind: "unexpected_response",
    message:
      "VerifyLoginApiKey returned no recognisable token. " +
      `Result type was ${result === null ? "null" : typeof result}.`,
    op: "VerifyLoginApiKey",
  });
}

export async function authenticate(
  client: Invoice4uClient,
  apiKey: string,
  mode: AuthMode,
  log: Logger,
): Promise<Session> {
  if (mode === "direct") {
    return { token: apiKey, mode: "direct" };
  }

  if (mode === "exchange") {
    const token = await exchange(client, apiKey);
    log.debug("authenticated via VerifyLoginApiKey exchange (forced)");
    return { token, mode: "exchange" };
  }

  // auto
  if (await tokenWorks(client, apiKey)) {
    log.info("auth mode resolved: direct (the API key is accepted as a session token)");
    return { token: apiKey, mode: "direct" };
  }

  log.debug("API key not accepted directly; falling back to VerifyLoginApiKey");
  const token = await exchange(client, apiKey);
  log.info("auth mode resolved: exchange (VerifyLoginApiKey returned a session token)");
  return { token, mode: "exchange" };
}
