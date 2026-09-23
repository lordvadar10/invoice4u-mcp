/**
 * Enumerations taken from the live production WSDL
 * (https://api.invoice4u.co.il/Services/ApiService.svc?singleWsdl, 2026-09-23).
 *
 * The numeric values come from the `<EnumerationValue>` annotations in the
 * contract, so they are authoritative rather than inferred. Note the gap in
 * DocumentType: 11 and 12 do not exist and PurchaseOrder is 13.
 */

export const DOCUMENT_TYPE = {
  invoice: 1,
  receipt: 2,
  invoice_receipt: 3,
  credit_invoice: 4,
  proforma: 5,
  order: 6,
  quote: 7,
  delivery_note: 8,
  deposits: 9,
  supplier_invoice_to_inventory: 10,
  purchase_order: 13,
} as const;

export type DocumentTypeName = keyof typeof DOCUMENT_TYPE;

export const DOCUMENT_TYPE_NAMES = Object.keys(DOCUMENT_TYPE) as DocumentTypeName[];

export const DOCUMENT_TYPE_BY_CODE: ReadonlyMap<number, DocumentTypeName> = new Map(
  Object.entries(DOCUMENT_TYPE).map(([name, code]) => [code, name as DocumentTypeName]),
);

/** Hebrew labels, for humans reading tool output. */
export const DOCUMENT_TYPE_HE: Readonly<Record<DocumentTypeName, string>> = {
  invoice: "חשבונית מס",
  receipt: "קבלה",
  invoice_receipt: "חשבונית מס קבלה",
  credit_invoice: "חשבונית זיכוי",
  proforma: "חשבון עסקה",
  order: "הזמנה",
  quote: "הצעת מחיר",
  delivery_note: "תעודת משלוח",
  deposits: "הפקדות",
  supplier_invoice_to_inventory: "חשבונית ספק למלאי",
  purchase_order: "הזמנת רכש",
};

/** WSDL simpleType `PaymentTypes`. */
export const PAYMENT_TYPE = {
  credit_card: 1,
  check: 2,
  bank_transfer: 3,
  cash: 4,
  credit: 5,
  withholding_tax: 6,
  other: 7,
  bit: 8,
  paybox: 9,
} as const;

export type PaymentTypeName = keyof typeof PAYMENT_TYPE;

export const PAYMENT_TYPE_BY_CODE: ReadonlyMap<number, PaymentTypeName> = new Map(
  Object.entries(PAYMENT_TYPE).map(([name, code]) => [code, name as PaymentTypeName]),
);

/** WSDL simpleType `ELanguage`. */
export const LANGUAGE = { hebrew: 1, english: 2 } as const;

/**
 * Document status.
 *
 * UNVERIFIED — the WSDL contains no enum for StatusID, so these names come from
 * a third-party integration and have never been checked against live data.
 * `documentStatusName` therefore never guesses: an unrecognised code is
 * reported as its number, not mapped to a plausible-looking name.
 *
 * @see docs/open-questions.md
 */
export const DOCUMENT_STATUS_UNVERIFIED: ReadonlyMap<number, string> = new Map([
  [1, "open"],
  [2, "closed"],
  [3, "fully_credited"],
  [4, "partially_credited"],
  [5, "cancelled"],
]);

export function documentTypeName(code: number | undefined): string {
  if (code === undefined) return "unknown";
  return DOCUMENT_TYPE_BY_CODE.get(code) ?? `unknown_type_${code}`;
}

export function paymentTypeName(code: number | undefined): string {
  if (code === undefined) return "unknown";
  return PAYMENT_TYPE_BY_CODE.get(code) ?? `unknown_payment_type_${code}`;
}

/** Returns `{ code, name? }` — `name` is omitted when the code is not one of the unverified five. */
export function documentStatusName(code: number | undefined): { code: number | null; name?: string } {
  if (code === undefined) return { code: null };
  const name = DOCUMENT_STATUS_UNVERIFIED.get(code);
  return name === undefined ? { code } : { code, name };
}
