/**
 * Wire-format helpers for the WCF JSON endpoint.
 *
 * Both of these were learned the hard way against the live service on
 * 2026-09-23, and neither is described in the published documentation.
 */

/**
 * Collection responses are NOT bare arrays.
 *
 * `GetDocuments` and `GetCustomersByOrgId` answer with
 * `{__type: "CommonCollectionOf…", Errors, Info, OpenInfo, Response: [...]}`,
 * while `GetBranches` answers with a bare array. Both shapes occur, so both
 * are handled here rather than at each call site.
 */
export function unwrapCollection(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (typeof result === "object" && result !== null) {
    const response = (result as Record<string, unknown>).Response;
    if (Array.isArray(response)) return response;
  }
  return [];
}

/**
 * Serialize a date for a REQUEST as `/Date(milliseconds)/`.
 *
 * An ISO-8601 string in a `DocumentsRequest` makes the service throw and
 * return HTTP 500 with a .NET stack trace, so this is not cosmetic.
 */
export function toWcfDate(isoDate: string, endOfDay = false): string {
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  return `/Date(${new Date(`${isoDate}${suffix}`).getTime()})/`;
}

/** Parse a `/Date(ms+ZZZZ)/` value from a RESPONSE into an ISO string. */
export function fromWcfDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const match = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  if (match !== null) {
    const ms = Number(match[1]);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}
