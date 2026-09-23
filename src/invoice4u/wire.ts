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

/**
 * Parse a `/Date(ms+ZZZZ)/` value from a RESPONSE.
 *
 * The offset is part of the answer, not decoration. Invoice4U sends document
 * dates as midnight **Israel time**, so `/Date(1748725200000+0300)/` is
 * 2026-06-01 locally but 2026-05-31T21:00Z in UTC. Rendering it as UTC moves
 * every document a day earlier and occasionally into the previous month, which
 * for VAT periods is the difference between one reporting month and another.
 *
 * So the offset is preserved: `2026-06-01T00:00:00+03:00`. The date portion is
 * then the calendar date the document actually carries.
 */
export function fromWcfDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;

  const match = /^\/Date\((-?\d+)(?:([+-])(\d{2})(\d{2}))?\)\/$/.exec(value);
  if (match !== null) {
    const ms = Number(match[1]);
    if (!Number.isFinite(ms)) return null;
    if (match[2] === undefined) return new Date(ms).toISOString();

    const sign = match[2] === "-" ? -1 : 1;
    const hours = Number(match[3]);
    const minutes = Number(match[4]);
    const offsetMs = sign * (hours * 60 + minutes) * 60_000;
    const shifted = new Date(ms + offsetMs).toISOString().slice(0, 19);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${shifted}${match[2]}${pad(hours)}:${pad(minutes)}`;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

/** The local calendar date (`YYYY-MM-DD`) a `/Date(…)/` value represents. */
export function wcfCalendarDate(value: unknown): string | null {
  const iso = fromWcfDate(value);
  return iso === null ? null : iso.slice(0, 10);
}
