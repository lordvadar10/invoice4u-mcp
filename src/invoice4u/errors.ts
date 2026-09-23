/**
 * Invoice4U reports business failures as HTTP 200 with a non-empty `Errors`
 * array inside the payload, and some operations answer with a bare error
 * string instead. Both are normalized here into one typed error so that
 * nothing upstream can mistake a failure for a success.
 */

export type ErrorKind =
  | "unauthorized"
  | "account_expired"
  | "not_found"
  | "already_exists"
  | "validation"
  | "api_error"
  | "network_error"
  | "unexpected_response"
  | "config_error";

/** A `CommonError` entry as the API spells it — including the `Paramters` typo. */
export interface CommonError {
  ID: number;
  Error: string;
  Paramters?: unknown;
}

export interface Invoice4uErrorInit {
  kind: ErrorKind;
  message: string;
  retryable?: boolean;
  op?: string;
  httpStatus?: number;
  apiErrors?: CommonError[];
}

export class Invoice4uError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly op: string | undefined;
  readonly httpStatus: number | undefined;
  readonly apiErrors: readonly CommonError[];

  constructor(init: Invoice4uErrorInit) {
    super(init.message);
    this.name = "Invoice4uError";
    this.kind = init.kind;
    this.retryable = init.retryable ?? false;
    this.op = init.op;
    this.httpStatus = init.httpStatus;
    this.apiErrors = init.apiErrors ?? [];
  }

  /** Structured form for an MCP tool result. Never includes credentials. */
  toResult(): Record<string, unknown> {
    return {
      ok: false,
      error: {
        kind: this.kind,
        message: this.message,
        retryable: this.retryable,
        ...(this.op === undefined ? {} : { operation: this.op }),
        ...(this.apiErrors.length === 0
          ? {}
          : { apiErrors: this.apiErrors.map((e) => ({ id: e.ID, error: e.Error })) }),
      },
    };
  }
}

/**
 * Known Invoice4U error identifiers.
 *
 * Only entries confirmed against the live service are mapped. Everything else
 * falls through to `api_error` rather than being guessed into a category.
 */
const KIND_BY_ERROR_TEXT: ReadonlyMap<string, ErrorKind> = new Map([
  ["UnauthorizedUser", "unauthorized"],
  ["ExpiredAccount", "account_expired"],
]);

/** Both observed live on 2026-09-23: 80 = UnauthorizedUser, 66 = ExpiredAccount. */
const KIND_BY_ERROR_ID: ReadonlyMap<number, ErrorKind> = new Map([
  [80, "unauthorized"],
  [66, "account_expired"],
]);

export function classify(errors: readonly CommonError[]): ErrorKind {
  for (const e of errors) {
    const byId = KIND_BY_ERROR_ID.get(e.ID);
    if (byId !== undefined) return byId;
    const byText = KIND_BY_ERROR_TEXT.get(e.Error);
    if (byText !== undefined) return byText;
  }
  return "api_error";
}

export function fromApiErrors(op: string, errors: readonly CommonError[]): Invoice4uError {
  const summary = errors.map((e) => `${e.Error} (${e.ID})`).join("; ");
  return new Invoice4uError({
    kind: classify(errors),
    message: `${op} failed: ${summary}`,
    op,
    apiErrors: [...errors],
  });
}

/** Redact anything that looks like a credential before an error escapes. */
export function redact(text: string, ...secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret.length >= 6) {
      out = out.split(secret).join("«redacted»");
    }
  }
  return out;
}
