/**
 * A single authenticated Invoice4U organisation.
 *
 * This is where the server's central safety property lives: the process is
 * bound to one organisation at startup. Nothing downstream can choose a
 * different one, because nothing downstream is ever offered the choice.
 */

import type { Config } from "../config.js";
import type { Logger } from "../log.js";
import { authenticate, type ResolvedAuthMode } from "./auth.js";
import { Invoice4uClient } from "./client.js";
import { Invoice4uError } from "./errors.js";

export interface OrgIdentity {
  /** Numeric organisation id, used by operations that require an orgID. */
  id: number | null;
  /** Every identifier the API offered, so a mismatch can say what was on offer. */
  candidates: Record<string, string>;
  label: string;
}

export interface Connection {
  client: Invoice4uClient;
  token: string;
  authMode: ResolvedAuthMode;
  org: OrgIdentity;
}

/**
 * Identifier fields worth comparing against INVOICE4U_EXPECT_ORG.
 *
 * Confirmed live on 2026-09-23: the company registration number arrives as
 * `OrganizationUniqueId` — note the lower-case `d` — and only from
 * GetUserData. `IsAuthenticated` carries `CompanyName` and `OrganizationID`
 * but not the registration number, so both calls are merged below.
 */
const ORG_ID_FIELDS: readonly string[] = [
  "OrganizationUniqueId",
  "OrganizationUniqueID",
  "OrganizationID",
  "CompanyNumber",
  "VatNumber",
  "OrgID",
  "ID",
];

const ORG_NAME_FIELDS: readonly string[] = ["CompanyName", "OrganizationName", "Name"];

function asString(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** Merge the identity fields of several payloads; earlier sources win. */
function extractIdentity(...sources: unknown[]): OrgIdentity {
  const candidates: Record<string, string> = {};
  let label: string | null = null;
  let id: number | null = null;

  for (const source of sources) {
    if (typeof source !== "object" || source === null) continue;
    const record = source as Record<string, unknown>;

    for (const field of ORG_ID_FIELDS) {
      const value = asString(record[field]);
      if (value !== null && candidates[field] === undefined) candidates[field] = value;
    }
    for (const field of ORG_NAME_FIELDS) {
      const value = asString(record[field]);
      if (value !== null) {
        if (candidates[field] === undefined) candidates[field] = value;
        label ??= value;
      }
    }
    if (id === null && typeof record.OrganizationID === "number") id = record.OrganizationID;
  }

  return { id, candidates, label: label ?? "unknown organisation" };
}

/**
 * Authenticate, identify the organisation, and enforce INVOICE4U_EXPECT_ORG.
 *
 * On mismatch this throws, and the caller registers no tools at all — a
 * misfiled key can only refuse to start, never act on the wrong company.
 */
export async function connect(config: Config, log: Logger): Promise<Connection> {
  const client = new Invoice4uClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    secrets: [config.apiKey],
  });

  const session = await authenticate(client, config.apiKey, config.authMode, log);

  // Two calls, because neither alone is enough: IsAuthenticated returns the
  // company name, GetUserData returns the registration number.
  const identity = await client.call("IsAuthenticated", {}, { token: session.token });
  const userData = await client
    .call("GetUserData", {}, { token: session.token })
    .catch((error: unknown) => {
      log.debug(`GetUserData unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });

  const org = extractIdentity(identity, userData);

  if (config.expectOrg !== undefined) {
    const matched = Object.values(org.candidates).some((value) => value === config.expectOrg);
    if (!matched) {
      const offered = Object.entries(org.candidates)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      throw new Invoice4uError({
        kind: "config_error",
        message:
          `Organisation mismatch. INVOICE4U_EXPECT_ORG is "${config.expectOrg}", but the key ` +
          `opened "${org.label}" (${offered || "no identifiers returned"}). ` +
          "Refusing to start — no tools registered. Check which key is filed under " +
          `${config.keySource}.`,
      });
    }
    log.info(`organisation asserted: ${org.label} matches INVOICE4U_EXPECT_ORG`);
  } else {
    log.warn(
      `no INVOICE4U_EXPECT_ORG set — serving whatever organisation the key opens (${org.label})`,
    );
  }

  return { client, token: session.token, authMode: session.mode, org };
}
