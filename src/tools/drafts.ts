/**
 * Draft tools.
 *
 * Reading drafts is a read and always available. Creating, updating and
 * deleting them are writes and only registered when INVOICE4U_ALLOW_WRITES is
 * "true".
 *
 * A draft is deliberately the whole write surface: it has no tax consequence,
 * carries no allocation number, and issuing it for real remains a human action
 * in the Invoice4U interface.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Config } from "../config.js";
import { buildDraft } from "../invoice4u/draft.js";
import { DOCUMENT_TYPE, documentTypeName } from "../invoice4u/enums.js";
import { Invoice4uError } from "../invoice4u/errors.js";
import { pickMoney } from "../invoice4u/money.js";
import type { Connection } from "../invoice4u/session.js";
import { fromWcfDate, unwrapCollection } from "../invoice4u/wire.js";
import { guard, type Json } from "./result.js";

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

/** Draft types worth offering. A draft of any of these is still only a draft. */
const DRAFT_TYPES = ["quote", "proforma", "order", "invoice", "invoice_receipt", "delivery_note"] as const;
type DraftTypeName = (typeof DRAFT_TYPES)[number];

const money = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, "decimal string, e.g. \"1250.00\" — never a float")
  .describe("Decimal string, e.g. \"1250.00\". Money is never passed as a number.");

const lineSchema = z.object({
  name: z.string().min(1).describe("Line description as it appears on the document."),
  quantity: money.default("1"),
  unitPrice: money.describe("Price per unit, BEFORE tax."),
  taxPercentage: money.optional().describe("Overrides the document rate for this line, e.g. \"0\" for exempt."),
});

const createSchema = z.object({
  documentType: z.enum(DRAFT_TYPES).describe("What the draft would become if issued."),
  customerId: z.number().int().positive().describe("From invoice4u_list_customers."),
  lines: z.array(lineSchema).min(1).max(100),
  taxPercentage: money.optional().describe("Defaults to the account's current VAT rate."),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Defaults to today."),
  subject: z.string().optional(),
  externalComments: z.string().optional().describe("Notes printed on the document."),
  currency: z.string().min(1).optional(),
  language: z.enum(["hebrew", "english"]).optional(),
});

const updateSchema = createSchema.extend({
  draftId: z.string().min(1),
  taxPercentage: money,
});

const draftIdSchema = z.object({ draftId: z.string().min(1) });
const listSchema = z.object({ limit: z.number().int().min(1).max(200).default(50) });

function shapeDraft(value: unknown): Json | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;
  if (d.ID === undefined && d.DocumentType === undefined) return null;
  return {
    draftId: typeof d.ID === "string" ? d.ID : null,
    documentType: documentTypeName(typeof d.DocumentType === "number" ? d.DocumentType : undefined),
    customer: { id: typeof d.ClientID === "number" ? d.ClientID : null, name: typeof d.ClientName === "string" ? d.ClientName : null },
    issueDate: fromWcfDate(d.IssueDate),
    currency: typeof d.Currency === "string" ? d.Currency : null,
    subject: typeof d.Subject === "string" && d.Subject !== "" ? d.Subject : null,
    totalWithoutTax: pickMoney(d, "TotalWithoutTax"),
    totalTax: pickMoney(d, "TotalTaxAmount"),
    total: pickMoney(d, "Total"),
    lineCount: Array.isArray(d.Items) ? d.Items.length : 0,
  };
}

export function registerDraftTools(
  server: McpServer,
  connection: Connection,
  config: Config,
): string[] {
  const { client, token, org } = connection;
  const call = <T>(op: string, params: Record<string, unknown> = {}, write = false): Promise<T> =>
    client.call<T>(op, params, { token, write });

  const names: string[] = [];
  const add = (name: string, register: () => void): void => {
    register();
    names.push(name);
  };

  add("invoice4u_list_drafts", () =>
    server.registerTool(
      "invoice4u_list_drafts",
      {
        title: "List drafts",
        description:
          "Unissued draft documents. A draft is not a tax document: it has no allocation number and no tax " +
          "consequence until someone issues it in Invoice4U.",
        inputSchema: listSchema,
        annotations: READ_ONLY,
      },
      guard(async (args: z.infer<typeof listSchema>) => {
        const rows = unwrapCollection(await call<unknown>("GetDraftDocuments", { dr: { Limit: args.limit } }));
        const drafts = rows.map(shapeDraft).filter((d): d is Json => d !== null);
        return { organisation: org.label, count: drafts.length, drafts };
      }),
    ),
  );

  add("invoice4u_get_draft", () =>
    server.registerTool(
      "invoice4u_get_draft",
      {
        title: "Get a draft",
        description: "One draft in full, including its line items.",
        inputSchema: draftIdSchema,
        annotations: READ_ONLY,
      },
      guard(async (args: z.infer<typeof draftIdSchema>) => {
        const raw = await call<unknown>("GetDraftDocument", { docId: args.draftId });
        const draft = shapeDraft(raw);
        if (draft === null) {
          throw new Invoice4uError({ kind: "not_found", message: `No draft with id ${args.draftId}.` });
        }
        const items = Array.isArray((raw as Record<string, unknown>).Items)
          ? ((raw as Record<string, unknown>).Items as unknown[]).map((i) => {
              const item = i as Record<string, unknown>;
              return {
                name: item.Name ?? null,
                quantity: pickMoney(item, "Quantity"),
                unitPrice: pickMoney(item, "Price"),
                taxPercentage: pickMoney(item, "TaxPercentage"),
                total: pickMoney(item, "Total"),
              };
            })
          : [];
        return { organisation: org.label, draft: { ...draft, items } };
      }),
    ),
  );

  if (!config.allowWrites) return names;

  add("invoice4u_create_draft", () =>
    server.registerTool(
      "invoice4u_create_draft",
      {
        title: "Create a draft",
        description:
          "Prepare an unissued draft document for review. This does NOT issue anything: a draft is not a tax " +
          "invoice, gets no allocation number, and has no tax consequence. Someone issues it by hand in " +
          "Invoice4U. Totals are computed from the line items — they cannot be supplied and cannot disagree " +
          "with the lines.",
        inputSchema: createSchema,
        annotations: WRITE,
      },
      guard(async (args: z.infer<typeof createSchema>) => {
        let taxPercentage = args.taxPercentage;
        if (taxPercentage === undefined) {
          const rate = await call<unknown>("GetTaxRate", {
            date: args.issueDate ?? new Date().toISOString().slice(0, 10),
          });
          const value = typeof rate === "object" && rate !== null ? (rate as Record<string, unknown>).TaxRate : rate;
          if (typeof value !== "number" || value < 0) {
            throw new Invoice4uError({
              kind: "validation",
              message: "Could not read the account's VAT rate — pass taxPercentage explicitly.",
            });
          }
          taxPercentage = value.toFixed(2);
        }

        const built = buildDraft({
          documentType: DOCUMENT_TYPE[args.documentType],
          customerId: args.customerId,
          lines: args.lines,
          taxPercentage,
          issueDate: args.issueDate,
          subject: args.subject,
          externalComments: args.externalComments,
          currency: args.currency,
          language: args.language === "english" ? 2 : 1,
          organizationId: org.id ?? undefined,
        });

        const created = await call<unknown>("CreateOrUpdateDraftDocument", { doc: built.payload }, true);
        const draft = shapeDraft(created);

        return {
          organisation: org.label,
          created: true,
          issued: false,
          note:
            "This is a DRAFT. Nothing has been issued, no allocation number was requested, and there is no " +
            "tax consequence. Issue it in Invoice4U when it is right, or delete it with invoice4u_delete_draft.",
          computedTotals: built.totals,
          lines: built.lines,
          draft,
        };
      }),
    ),
  );

  add("invoice4u_update_draft", () =>
    server.registerTool(
      "invoice4u_update_draft",
      {
        title: "Replace a draft's contents",
        description:
          "Replace an existing draft's lines and details. The draft is re-read first and its previous state is " +
          "returned alongside the new one. Still a draft: nothing is issued.",
        inputSchema: updateSchema,
        annotations: WRITE,
      },
      guard(async (args: z.infer<typeof updateSchema>) => {
        const before = shapeDraft(await call<unknown>("GetDraftDocument", { docId: args.draftId }));
        if (before === null) {
          throw new Invoice4uError({ kind: "not_found", message: `No draft with id ${args.draftId}.` });
        }

        const built = buildDraft({
          documentType: DOCUMENT_TYPE[args.documentType],
          customerId: args.customerId,
          lines: args.lines,
          taxPercentage: args.taxPercentage,
          issueDate: args.issueDate,
          subject: args.subject,
          externalComments: args.externalComments,
          currency: args.currency,
          language: args.language === "english" ? 2 : 1,
          organizationId: org.id ?? undefined,
          draftId: args.draftId,
        });

        await call<unknown>("CreateOrUpdateDraftDocument", { doc: built.payload }, true);
        const after = shapeDraft(await call<unknown>("GetDraftDocument", { docId: args.draftId }));

        return { organisation: org.label, updated: true, issued: false, previous: before, current: after, computedTotals: built.totals };
      }),
    ),
  );

  add("invoice4u_delete_draft", () =>
    server.registerTool(
      "invoice4u_delete_draft",
      {
        title: "Delete a draft",
        description:
          "Permanently delete an unissued draft. The draft is read first so the result says exactly what was " +
          "removed. Only drafts can be deleted — this cannot touch an issued document.",
        inputSchema: draftIdSchema,
        annotations: DESTRUCTIVE,
      },
      guard(async (args: z.infer<typeof draftIdSchema>) => {
        const before = shapeDraft(await call<unknown>("GetDraftDocument", { docId: args.draftId }));
        if (before === null) {
          throw new Invoice4uError({
            kind: "not_found",
            message: `No draft with id ${args.draftId} — nothing was deleted.`,
          });
        }
        await call<unknown>("DeleteDraftDocument", { docId: args.draftId }, true);
        const after = await call<unknown>("GetDraftDocument", { docId: args.draftId }).catch(() => null);
        return {
          organisation: org.label,
          deleted: shapeDraft(after) === null,
          removed: before,
          ...(shapeDraft(after) === null ? {} : { warning: "The draft still reads back — deletion may not have applied." }),
        };
      }),
    ),
  );

  return names;
}
