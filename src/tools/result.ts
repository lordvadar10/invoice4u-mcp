/**
 * Tool result helpers.
 *
 * An Invoice4U failure always becomes a structured tool error — never a
 * success with an empty payload, which is the shape the API's
 * HTTP-200-with-Errors habit would otherwise produce.
 */

import { Invoice4uError } from "../invoice4u/errors.js";

export type Json = Record<string, unknown>;

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function ok(payload: Json): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...payload }, null, 2) }] };
}

export function fail(error: unknown): ToolResult {
  const body =
    error instanceof Invoice4uError
      ? error.toResult()
      : { ok: false, error: { kind: "unexpected_response", message: String(error) } };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
}

/** Wrap a handler so a failure surfaces as a tool error rather than a success. */
export function guard<A>(handler: (args: A) => Promise<Json>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return ok(await handler(args));
    } catch (error) {
      return fail(error);
    }
  };
}
