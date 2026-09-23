/**
 * The only sanctioned way to talk to Invoice4U.
 *
 * Wire protocol, verified against the live production service on 2026-09-23:
 *
 *   POST {baseUrl}/{Operation}
 *   Content-Type: application/json
 *   { ...params, "token": "<session token>" }
 *
 *   -> 200 {"d": <result>}
 *
 * Three behaviours this has to absorb:
 *
 *  1. The envelope key is `d` (ASP.NET ScriptService), NOT `<Op>Result`.
 *  2. Business failures arrive as HTTP 200 with a non-empty `Errors` array
 *     inside the payload. A non-empty `Errors` is NEVER a success.
 *  3. Some operations answer with a bare string instead of an object — e.g.
 *     GetExpDateByApiKey returns {"d":"UnauthorizedUser"}.
 *
 * Reads retry on transport failures only. Writes are never retried: recovery
 * runs through GetDocumentByApiIdentifier so a timeout cannot create a second
 * document.
 */

import { type CommonError, Invoice4uError, fromApiErrors, redact } from "./errors.js";

export interface ClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Redacted from every error and log line that escapes this client. */
  secrets?: (string | undefined)[];
}

export interface CallOptions {
  /** Writes are never auto-retried. Any op starting with "Create" is one implicitly. */
  write?: boolean;
  /** Overrides the token sent in the body. */
  token?: string;
}

export const MAX_READ_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 150;

/** Bare-string results that are really errors rather than values. */
const BARE_ERROR_STRINGS: ReadonlySet<string> = new Set([
  "UnauthorizedUser",
  "InvalidToken",
  "SessionExpired",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommonError(value: unknown): value is CommonError {
  return isRecord(value) && typeof value.ID === "number" && typeof value.Error === "string";
}

/** Collect de-duplicated errors from anywhere they might appear. */
export function collectErrors(...candidates: unknown[]): CommonError[] {
  const out: CommonError[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !Array.isArray(candidate.Errors)) continue;
    for (const entry of candidate.Errors) {
      if (!isCommonError(entry)) continue;
      const duplicate = out.some((e) => e.ID === entry.ID && e.Error === entry.Error);
      if (!duplicate) {
        out.push({ ID: entry.ID, Error: entry.Error, Paramters: entry.Paramters });
      }
    }
  }
  return out;
}

/**
 * Unwrap one parsed response body.
 *
 * Exported so the envelope rules can be tested without a network round trip —
 * this is the part most likely to be got wrong.
 */
export function unwrapEnvelope(op: string, parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    throw new Invoice4uError({
      kind: "unexpected_response",
      message: `${op}: response was not a JSON object`,
      op,
    });
  }

  if (!("d" in parsed)) {
    throw new Invoice4uError({
      kind: "unexpected_response",
      message:
        `${op}: response has no "d" envelope key. Got: ${Object.keys(parsed).join(", ") || "{}"}`,
      op,
    });
  }

  const result = parsed.d;

  // A bare string result may itself be the error.
  if (typeof result === "string" && BARE_ERROR_STRINGS.has(result)) {
    throw fromApiErrors(op, [{ ID: -1, Error: result }]);
  }

  const errors = collectErrors(parsed, result);
  if (errors.length > 0) throw fromApiErrors(op, errors);

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name: unknown }).name === "AbortError" ||
      (error as { name: unknown }).name === "TimeoutError")
  );
}

export class Invoice4uClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly secrets: (string | undefined)[];

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.secrets = options.secrets ?? [];
  }

  async call<T = unknown>(
    op: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<T> {
    const isWrite = options.write === true || op.startsWith("Create");
    const maxAttempts = isWrite ? 1 : MAX_READ_RETRIES + 1;

    let lastError: Invoice4uError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return (await this.callOnce(op, params, options)) as T;
      } catch (error) {
        if (!(error instanceof Invoice4uError) || !error.retryable) throw error;
        lastError = error;
        if (attempt < maxAttempts) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  private async callOnce(
    op: string,
    params: Record<string, unknown>,
    options: CallOptions,
  ): Promise<unknown> {
    const url = `${this.baseUrl}/${op}`;
    const body =
      options.token === undefined
        ? JSON.stringify(params)
        : JSON.stringify({ ...params, token: options.token });

    let response: Response;
    let raw: string;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      raw = await response.text();
    } catch (error) {
      const detail = isAbort(error)
        ? `timed out after ${this.timeoutMs}ms`
        : redact(error instanceof Error ? error.message : String(error), ...this.secrets);
      throw new Invoice4uError({
        kind: "network_error",
        retryable: true,
        message: `${op}: ${detail}`,
        op,
      });
    }

    if (response.status >= 500) {
      throw new Invoice4uError({
        kind: "network_error",
        retryable: true,
        message: `${op}: server error HTTP ${response.status}`,
        op,
        httpStatus: response.status,
      });
    }
    if (!response.ok) {
      throw new Invoice4uError({
        kind: "unexpected_response",
        message: `${op}: unexpected HTTP ${response.status}`,
        op,
        httpStatus: response.status,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // The WCF help page is HTML — a strong signal the operation name is wrong.
      const hint = raw.trimStart().startsWith("<")
        ? ' (got HTML — check the operation name; only the bare "/{Operation}" path serves JSON)'
        : "";
      throw new Invoice4uError({
        kind: "unexpected_response",
        message: `${op}: response was not valid JSON${hint}`,
        op,
      });
    }

    return unwrapEnvelope(op, parsed);
  }
}
