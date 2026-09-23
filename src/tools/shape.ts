/**
 * Shaping API payloads into tool output.
 *
 * Invoice4U documents carry ~120 fields and customers ~60, most of them
 * internal. These projections keep responses small and — for customers —
 * withhold bank and stored-card details, which sit on the plain record.
 */

import {
  documentStatusName,
  documentTypeName,
  paymentTypeName,
} from "../invoice4u/enums.js";
import { pickDecimal } from "../invoice4u/money.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number") return String(value);
  return null;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * WCF serializes dates as `/Date(1690000000000+0300)/`. Converted to ISO here
 * so tool output is comparable and sortable.
 */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const wcf = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  if (wcf !== null) {
    const ms = Number(wcf[1]);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

export interface AllocationView {
  number: string | null;
  message: string | null;
  declineStatus: number | null;
  /** true only when an allocation number is actually present. */
  present: boolean;
}

/**
 * Israeli allocation number (מספר הקצאה).
 *
 * Surfaced on every document because an invoice that issues without one is a
 * real problem — the customer cannot deduct the VAT — and the API will happily
 * return HTTP 200 either way.
 */
export function allocationView(doc: Record<string, unknown>): AllocationView {
  const number = str(doc.AllocationNumber);
  return {
    number,
    message: str(doc.AllocationMessage),
    declineStatus: num(doc.IsraelInvoicesDeclineStatus) ?? null,
    present: number !== null,
  };
}

export function shapeDocumentSummary(value: unknown): Record<string, unknown> | null {
  const doc = record(value);
  if (doc === undefined) return null;
  return {
    id: str(doc.ID),
    documentNumber: num(doc.DocumentNumber) ?? str(doc.DocumentNumber),
    documentType: documentTypeName(num(doc.DocumentType)),
    status: documentStatusName(num(doc.StatusID)),
    issueDate: toIsoDate(doc.IssueDate),
    customer: { id: num(doc.ClientID) ?? null, name: str(doc.ClientName) },
    currency: str(doc.Currency),
    total: pickDecimal(doc, "Total"),
    totalWithoutTax: pickDecimal(doc, "TotalWithoutTax"),
    balance: pickDecimal(doc, "Balance"),
    paid: pickDecimal(doc, "Paid"),
    allocation: allocationView(doc),
  };
}

export function shapeDocumentDetail(value: unknown): Record<string, unknown> | null {
  const doc = record(value);
  if (doc === undefined) return null;
  const summary = shapeDocumentSummary(doc);
  if (summary === null) return null;

  const items = Array.isArray(doc.Items)
    ? doc.Items.map((raw) => {
        const item = record(raw);
        if (item === undefined) return null;
        return {
          name: str(item.Name),
          code: str(item.Code),
          description: str(item.Description),
          quantity: pickDecimal(item, "Quantity"),
          unitPrice: pickDecimal(item, "Price"),
          taxPercentage: pickDecimal(item, "TaxPercentage"),
          total: pickDecimal(item, "Total"),
        };
      }).filter((v) => v !== null)
    : [];

  const payments = Array.isArray(doc.Payments)
    ? doc.Payments.map((raw) => {
        const payment = record(raw);
        if (payment === undefined) return null;
        return {
          amount: pickDecimal(payment, "Amount"),
          date: toIsoDate(payment.Date),
          method: paymentTypeName(num(payment.PaymentType)),
          paymentNumber: str(payment.PaymentNumber),
        };
      }).filter((v) => v !== null)
    : [];

  const linked = Array.isArray(doc.Invoices)
    ? doc.Invoices.map(shapeDocumentSummary).filter((v) => v !== null)
    : [];

  return {
    ...summary,
    subject: str(doc.Subject),
    apiIdentifier: str(doc.ApiIdentifier),
    taxPercentage: pickDecimal(doc, "TaxPercentage"),
    totalTaxAmount: pickDecimal(doc, "TotalTaxAmount"),
    paymentDueDate: toIsoDate(doc.PaymentDueDate),
    externalComments: str(doc.ExternalComments),
    pdfUrl: str(doc.PrintOriginalPDFLink),
    items,
    payments,
    linkedDocuments: linked,
  };
}

/**
 * Customer projection.
 *
 * Bank details (BankName/BranchCode/AccountNumber), CreditCardNumber and the
 * stored-card Token are deliberately dropped. They live on the plain customer
 * record and there is no read tool that needs them.
 */
export function shapeCustomer(value: unknown, includeContact: boolean): Record<string, unknown> | null {
  const customer = record(value);
  if (customer === undefined) return null;

  const base: Record<string, unknown> = {
    id: num(customer.ID) ?? null,
    name: str(customer.Name),
    active: customer.Active === true,
    uniqueId: str(customer.UniqueID),
    clientCode: num(customer.ClientCode) ?? null,
  };

  if (!includeContact) return base;

  return {
    ...base,
    email: str(customer.Email),
    phone: str(customer.Phone),
    cell: str(customer.Cell),
    address: str(customer.Address),
    city: str(customer.City),
    zip: str(customer.Zip),
    country: str(customer.Country),
    website: str(customer.Website),
    payTerms: num(customer.PayTerms) ?? null,
    dateCreated: toIsoDate(customer.DateCreated),
    hasStoredPaymentDetails: customer.HasToken === true,
    _redacted: "bank account, credit-card number and stored-card token are never returned",
  };
}

export function shapeBranch(value: unknown): Record<string, unknown> | null {
  const branch = record(value);
  if (branch === undefined) return null;
  return {
    id: num(branch.ID) ?? num(branch.BranchID) ?? null,
    name: str(branch.Name) ?? str(branch.BranchName),
    active: branch.Active === true,
  };
}
