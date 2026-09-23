/**
 * Building a draft document.
 *
 * Drafts are the only documents this server creates. A draft has no tax
 * consequence — it is not a tax invoice, carries no allocation number, and is
 * deleted with a single call. Issuing it for real stays a human action in the
 * Invoice4U interface, which is the point.
 *
 * Totals are computed here from the line items and are never accepted from the
 * caller, so a draft cannot claim a total that disagrees with its own lines.
 */

import { fromCents, multiplyMoney, percentOf, sumMoney, toCents, toMoneyString } from "./money.js";
import { toWcfDate } from "./wire.js";

export interface DraftLineInput {
  name: string;
  description?: string | undefined;
  quantity: string;
  unitPrice: string;
  /** Overrides the document tax rate for this line (e.g. "0" for an exempt line). */
  taxPercentage?: string | undefined;
}

export interface DraftInput {
  documentType: number;
  customerId: number;
  lines: DraftLineInput[];
  taxPercentage: string;
  issueDate?: string | undefined;
  subject?: string | undefined;
  externalComments?: string | undefined;
  currency?: string | undefined;
  language?: number | undefined;
  branchId?: number | undefined;
  organizationId?: number | undefined;
  /** Updating an existing draft rather than creating one. */
  draftId?: string | undefined;
}

export interface DraftTotals {
  totalWithoutTax: string;
  totalTax: string;
  total: string;
}

export interface BuiltDraft {
  payload: Record<string, unknown>;
  totals: DraftTotals;
  lines: { name: string; quantity: string; unitPrice: string; taxPercentage: string; lineTotalWithoutTax: string; lineTax: string; lineTotal: string }[];
}

export function buildDraft(input: DraftInput): BuiltDraft {
  if (input.lines.length === 0) {
    throw new TypeError("a draft needs at least one line item");
  }

  const lines = input.lines.map((line) => {
    const taxPercentage = toMoneyString(line.taxPercentage ?? input.taxPercentage);
    if (taxPercentage === null) throw new TypeError(`line "${line.name}": bad tax percentage`);

    const lineTotalWithoutTax = multiplyMoney(line.unitPrice, line.quantity);
    const lineTax = percentOf(lineTotalWithoutTax, taxPercentage);
    const lineTotal = fromCents(toCents(lineTotalWithoutTax) + toCents(lineTax));
    const unitPrice = toMoneyString(line.unitPrice);
    const quantity = toMoneyString(line.quantity);
    if (unitPrice === null || quantity === null) {
      throw new TypeError(`line "${line.name}": bad quantity or unit price`);
    }
    return { name: line.name, description: line.description, quantity, unitPrice, taxPercentage, lineTotalWithoutTax, lineTax, lineTotal };
  });

  const totals: DraftTotals = {
    totalWithoutTax: sumMoney(lines.map((l) => l.lineTotalWithoutTax)),
    totalTax: sumMoney(lines.map((l) => l.lineTax)),
    total: sumMoney(lines.map((l) => l.lineTotal)),
  };

  const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);

  const payload: Record<string, unknown> = {
    DocumentType: input.documentType,
    ClientID: input.customerId,
    IssueDate: toWcfDate(issueDate),
    Currency: input.currency ?? "₪",
    Language: input.language ?? 1,
    TaxPercentage: Number(input.taxPercentage),
    TotalWithoutTax: Number(totals.totalWithoutTax),
    TotalTaxAmount: Number(totals.totalTax),
    Total: Number(totals.total),
    Items: lines.map((l) => ({
      Name: l.name,
      ...(l.description === undefined ? {} : { Description: l.description }),
      Quantity: Number(l.quantity),
      Price: Number(l.unitPrice),
      PriceIncludeTax: Number(fromCents(toCents(l.unitPrice) + toCents(percentOf(l.unitPrice, l.taxPercentage)))),
      TaxPercentage: Number(l.taxPercentage),
      TotalWithoutTax: Number(l.lineTotalWithoutTax),
      TotalTax: Number(l.lineTax),
      Total: Number(l.lineTotal),
    })),
  };

  if (input.subject !== undefined) payload.Subject = input.subject;
  if (input.externalComments !== undefined) payload.ExternalComments = input.externalComments;
  if (input.branchId !== undefined) payload.BranchID = input.branchId;
  if (input.organizationId !== undefined) payload.OrganizationID = input.organizationId;

  // An ID present means update; absent means create. Never inferred.
  if (input.draftId !== undefined) {
    payload.ID = input.draftId;
    payload.UniqueID = input.draftId;
  }

  return { payload, totals, lines };
}
