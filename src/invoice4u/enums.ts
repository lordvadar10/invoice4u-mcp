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
 * The WSDL contains no enum for StatusID. Codes 1, 2 and 3 were confirmed
 * against live production data on 2026-09-23, where the API also returns a
 * Hebrew `Status` string alongside the id:
 *
 *   1 = פתוחה (open)  ·  2 = סגורה (closed)  ·  3 = מזוכית (credited)
 *
 * Anything else is still unknown and is reported as a bare number rather than
 * guessed. The API's own `Status` string is passed through when present, so
 * callers never depend on this map alone.
 */
export const DOCUMENT_STATUS_VERIFIED: ReadonlyMap<number, string> = new Map([
  [1, "open"],
  [2, "closed"],
  [3, "credited"],
]);

export function documentTypeName(code: number | undefined): string {
  if (code === undefined) return "unknown";
  return DOCUMENT_TYPE_BY_CODE.get(code) ?? `unknown_type_${code}`;
}

export function paymentTypeName(code: number | undefined): string {
  if (code === undefined) return "unknown";
  return PAYMENT_TYPE_BY_CODE.get(code) ?? `unknown_payment_type_${code}`;
}

/**
 * Returns `{ code, name?, label? }`.
 *
 * `name` appears only for a code confirmed against live data; `label` is the
 * API's own Hebrew status string when it supplied one.
 */
export function documentStatusName(
  code: number | undefined,
  apiLabel?: unknown,
): { code: number | null; name?: string; label?: string } {
  const label = typeof apiLabel === "string" && apiLabel !== "" ? apiLabel : undefined;
  if (code === undefined) return label === undefined ? { code: null } : { code: null, label };
  const name = DOCUMENT_STATUS_VERIFIED.get(code);
  return {
    code,
    ...(name === undefined ? {} : { name }),
    ...(label === undefined ? {} : { label }),
  };
}
