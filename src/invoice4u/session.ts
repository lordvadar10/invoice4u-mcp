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
 * Which field carries the company number is not yet confirmed against live
 * data, so the assertion accepts a match on ANY of them rather than guessing
 * one. See docs/open-questions.md.
 */
const ORG_ID_FIELDS: readonly string[] = [
  "CompanyNumber",
  "OrganizationUniqueID",
  "OrganizationID",
  "OrgID",
  "UniqueID",
  "ID",
  "VatNumber",
  "CompanyId",
  "CompanyID",
];

const ORG_NAME_FIELDS: readonly string[] = ["OrganizationName", "CompanyName", "Name", "Email"];

function extractIdentity(userData: unknown): OrgIdentity {
  const candidates: Record<string, string> = {};
  let label = "unknown organisation";

  if (typeof userData === "object" && userData !== null) {
    const record = userData as Record<string, unknown>;
    for (const field of ORG_ID_FIELDS) {
      const value = record[field];
      if (typeof value === "string" && value !== "") candidates[field] = value;
      else if (typeof value === "number") candidates[field] = String(value);
    }
    for (const field of ORG_NAME_FIELDS) {
      const value = record[field];
      if (typeof value === "string" && value !== "") {
        candidates[field] = value;
        if (label === "unknown organisation") label = value;
      }
    }
  }

  return { candidates, label };
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

  let org: OrgIdentity;
  try {
    org = extractIdentity(await client.call("GetUserData", {}, { token: session.token }));
  } catch (error) {
    if (config.expectOrg !== undefined) throw error;
    log.warn(
      `could not read organisation details: ${error instanceof Error ? error.message : String(error)}`,
    );
    org = { candidates: {}, label: "unknown organisation" };
  }

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
