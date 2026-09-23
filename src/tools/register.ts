/**
 * Tool registration.
 *
 * Every tool here is read-only. The write surface is intentionally absent from
 * v0.1 — see README, "Not implemented".
 *
 * No tool takes an account, organisation or business argument: the process is
 * already bound to exactly one organisation, so there is nothing to choose.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Config } from "../config.js";
import { DOCUMENT_TYPE, DOCUMENT_TYPE_HE, type DocumentTypeName } from "../invoice4u/enums.js";
import { Invoice4uError } from "../invoice4u/errors.js";
import type { Connection } from "../invoice4u/session.js";
import { toWcfDate, unwrapCollection } from "../invoice4u/wire.js";
import {
  allocationView,
  shapeBranch,
  shapeCustomer,
  shapeDocumentDetail,
  shapeDocumentSummary,
} from "./shape.js";

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

type Json = Record<string, unknown>;

function ok(payload: Json): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...payload }, null, 2) }] };
}

function fail(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const body =
    error instanceof Invoice4uError
      ? error.toResult()
      : { ok: false, error: { kind: "unexpected_response", message: String(error) } };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
}

/** Wrap a handler so an Invoice4U failure becomes a structured tool error, never a success. */
function guard<A>(handler: (args: A) => Promise<Json>) {
  return async (args: A) => {
    try {
      return ok(await handler(args));
    } catch (error) {
      return fail(error);
    }
  };
}

const documentTypeEnum = z.enum(
  Object.keys(DOCUMENT_TYPE) as [DocumentTypeName, ...DocumentTypeName[]],
);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .describe("Date as YYYY-MM-DD");

export function registerTools(server: McpServer, connection: Connection, config: Config): string[] {
  const { client, token, org, authMode } = connection;
  const call = <T>(op: string, params: Record<string, unknown> = {}): Promise<T> =>
    client.call<T>(op, params, { token });

  const registered: string[] = [];
  const add = (name: string, register: () => void): void => {
    register();
    registered.push(name);
  };

  add("invoice4u_verify_connection", () =>
    server.registerTool(
      "invoice4u_verify_connection",
      {
        title: "Verify Invoice4U connection",
        description:
          "Confirm which Invoice4U organisation this server is bound to, and how it authenticated. " +
          "Run this first when it matters which company is in play — every other tool acts on this " +
          "organisation and only this one.",
        inputSchema: z.object({}),
        annotations: READ_ONLY,
      },
      guard(async () => {
        const branches = await call<unknown>("GetBranches")
          .then(unwrapCollection)
          .catch(() => null);
        return {
          organisation: org.label,
          identifiers: org.candidates,
          environment: config.env,
          baseUrl: config.baseUrl,
          authMode,
          keySource: config.keySource,
          organisationAsserted: config.expectOrg !== undefined,
          writesEnabled: config.allowWrites,
          branchCount: branches === null ? null : branches.length,
        };
      }),
    ),
  );

  add("invoice4u_list_documents", () =>
    server.registerTool(
      "invoice4u_list_documents",
      {
        title: "List documents",
        description:
          "Search invoices, receipts, quotes and other documents by type, date range, customer or " +
          "amount. Returns summaries including balance and allocation-number status. Line items and " +
          "payments are omitted unless includeItems/includePayments are set.",
        inputSchema: z.object({
          documentType: documentTypeEnum.optional().describe(
            "One document type. Document numbers are sequential per type.",
          ),
          fromDate: dateString.optional(),
          toDate: dateString.optional(),
          customerId: z.number().int().positive().optional(),
          customerName: z.string().min(1).optional(),
          fromAmount: z.number().optional(),
          toAmount: z.number().optional(),
          currency: z.string().min(1).optional().describe(
            'Currency as the account stores it — often the symbol, e.g. "₪".',
          ),
          limit: z.number().int().min(1).max(500).default(50),
          includeItems: z.boolean().default(false),
          includePayments: z.boolean().default(false),
        }),
        annotations: READ_ONLY,
      },
      guard(async (args) => {
        const dr: Record<string, unknown> = {
          Limit: args.limit,
          ItemsIncluded: args.includeItems,
          PaymentsIncluded: args.includePayments,
        };
        if (args.documentType !== undefined) dr.DocumentType = DOCUMENT_TYPE[args.documentType];
        // Dates MUST go out as /Date(ms)/ — an ISO string makes the service
        // throw and answer HTTP 500.
        if (args.fromDate !== undefined) dr.From = toWcfDate(args.fromDate);
        if (args.toDate !== undefined) dr.To = toWcfDate(args.toDate, true);
        if (args.customerId !== undefined) dr.CustomerID = args.customerId;
        if (args.customerName !== undefined) dr.CustomerName = args.customerName;
        if (args.fromAmount !== undefined) dr.FromAmount = args.fromAmount;
        if (args.toAmount !== undefined) dr.ToAmount = args.toAmount;
        if (args.currency !== undefined) dr.Currency = args.currency;

        const rows = unwrapCollection(await call<unknown>("GetDocuments", { dr }));
        const documents = rows.map(shapeDocumentSummary).filter((d) => d !== null);

        return {
          organisation: org.label,
          count: documents.length,
          documents,
          ...(documents.length >= args.limit
            ? {
                note:
                  `Result hit the limit of ${args.limit}. The API has no cursor — narrow the ` +
                  "date range or raise limit to see more.",
              }
            : {}),
        };
      }),
    ),
  );

  add("invoice4u_get_document", () =>
    server.registerTool(
      "invoice4u_get_document",
      {
        title: "Get a document",
        description:
          "Fetch one document in full — line items, payments, linked documents, PDF link and " +
          "allocation-number status. Look it up by id, by number plus type, or by apiIdentifier.",
        inputSchema: z
          .object({
            documentId: z.string().min(1).optional().describe("The document GUID."),
            documentNumber: z.number().int().positive().optional(),
            documentType: documentTypeEnum.optional().describe(
              "Required with documentNumber — numbering is per type.",
            ),
            apiIdentifier: z.string().min(1).optional(),
          })
          .refine(
            (a) =>
              a.documentId !== undefined ||
              a.apiIdentifier !== undefined ||
              (a.documentNumber !== undefined && a.documentType !== undefined),
            {
              message:
                "Provide documentId, or apiIdentifier, or both documentNumber and documentType.",
            },
          ),
        annotations: READ_ONLY,
      },
      guard(async (args) => {
        let raw: unknown;
        if (args.documentId !== undefined) {
          raw = await call("GetDocument", { docId: args.documentId });
        } else if (args.apiIdentifier !== undefined) {
          raw = await call("GetDocumentByApiIdentifier", {
            apiIdentifier: args.apiIdentifier,
            docType:
              args.documentType === undefined ? 0 : DOCUMENT_TYPE[args.documentType],
          });
        } else {
          raw = await call("GetDocumentByNumber", {
            docNumber: args.documentNumber,
            documentType: DOCUMENT_TYPE[args.documentType as DocumentTypeName],
          });
        }

        const document = shapeDocumentDetail(raw);
        if (document === null) {
          throw new Invoice4uError({ kind: "not_found", message: "No document matched." });
        }
        return { organisation: org.label, document };
      }),
    ),
  );

  add("invoice4u_check_allocation_status", () =>
    server.registerTool(
      "invoice4u_check_allocation_status",
      {
        title: "Check allocation numbers (מספר הקצאה)",
        description:
          "Report which tax invoices in a date range are missing their Israeli allocation number. " +
          "A qualifying invoice without one is not recognised for the customer's VAT input " +
          "deduction, so anything listed under 'missing' needs attention.",
        inputSchema: z.object({
          fromDate: dateString,
          toDate: dateString,
          documentType: documentTypeEnum.default("invoice"),
          limit: z.number().int().min(1).max(500).default(200),
        }),
        annotations: READ_ONLY,
      },
      guard(async (args) => {
        const rows = unwrapCollection(
          await call<unknown>("GetDocuments", {
            dr: {
              DocumentType: DOCUMENT_TYPE[args.documentType],
              From: toWcfDate(args.fromDate),
              To: toWcfDate(args.toDate, true),
              Limit: args.limit,
            },
          }),
        );

        const withAllocation: Json[] = [];
        const missing: Json[] = [];
        for (const row of rows) {
          const summary = shapeDocumentSummary(row);
          if (summary === null) continue;
          const allocation = allocationView(row as Record<string, unknown>);
          (allocation.present ? withAllocation : missing).push(summary);
        }

        return {
          organisation: org.label,
          documentType: `${args.documentType} (${DOCUMENT_TYPE_HE[args.documentType]})`,
          range: { from: args.fromDate, to: args.toDate },
          checked: rows.length,
          withAllocationNumber: withAllocation.length,
          missingAllocationNumber: missing.length,
          missing,
        };
      }),
    ),
  );

  add("invoice4u_list_customers", () =>
    server.registerTool(
      "invoice4u_list_customers",
      {
        title: "List customers",
        description:
          "List or search customers of this organisation. Returns identifiers and names only — use " +
          "invoice4u_get_customer for contact details.",
        inputSchema: z.object({
          nameContains: z.string().min(1).optional(),
          activeOnly: z.boolean().default(true),
          limit: z.number().int().min(1).max(500).default(100),
        }),
        annotations: READ_ONLY,
      },
      guard(async (args) => {
        const rows = unwrapCollection(await call<unknown>("GetCustomersByOrgId"));

        let customers = rows.map((r) => shapeCustomer(r, false)).filter((c) => c !== null);
        if (args.activeOnly) customers = customers.filter((c) => c.active === true);
        if (args.nameContains !== undefined) {
          const needle = args.nameContains.toLowerCase();
          customers = customers.filter((c) => String(c.name ?? "").toLowerCase().includes(needle));
        }

        return {
          organisation: org.label,
          total: customers.length,
          returned: Math.min(customers.length, args.limit),
          customers: customers.slice(0, args.limit),
        };
      }),
    ),
  );

  add("invoice4u_get_customer", () =>
    server.registerTool(
      "invoice4u_get_customer",
      {
        title: "Get a customer",
        description:
          "Full contact details for one customer. Bank account, credit-card number and stored-card " +
          "token are never returned.",
        inputSchema: z.object({ customerId: z.number().int().positive() }),
        annotations: READ_ONLY,
      },
      guard(async (args) => {
        const raw = await call("GetFullCustomer", {
          id: args.customerId,
          orgID: org.id ?? 0,
        });
        const customer = shapeCustomer(raw, true);
        if (customer === null) {
          throw new Invoice4uError({
            kind: "not_found",
            message: `No customer with id ${args.customerId}.`,
          });
        }
        return { organisation: org.label, customer };
      }),
    ),
  );

  add("invoice4u_list_branches", () =>
    server.registerTool(
      "invoice4u_list_branches",
      {
        title: "List branches",
        description: "Branches configured for this organisation.",
        inputSchema: z.object({}),
        annotations: READ_ONLY,
      },
      guard(async () => {
        const rows = unwrapCollection(await call<unknown>("GetBranches"));
        return {
          organisation: org.label,
          branches: rows.map(shapeBranch).filter((b) => b !== null),
        };
      }),
    ),
  );

  add("invoice4u_get_tax_rate", () =>
    server.registerTool(
      "invoice4u_get_tax_rate",
      {
        title: "Get VAT rate",
        description: "The VAT rate in effect on a given date (today when omitted).",
        inputSchema: z.object({ date: dateString.optional() }),
        annotations: READ_ONLY,
      },
      guard(async (args) => {
        const date = args.date ?? new Date().toISOString().slice(0, 10);
        const result = await call<unknown>("GetTaxRate", { date });
        const rate =
          typeof result === "object" && result !== null
            ? (result as Record<string, unknown>).TaxRate
            : result;
        return { organisation: org.label, date, taxRate: rate ?? null };
      }),
    ),
  );

  return registered;
}
