# Open questions

Status after live verification against two real Invoice4U accounts on
**2026-09-23**. Five of the seven original questions are now settled; two
remain.

## Settled

### 1. Is an API key usable directly as the session token? — **YES**

Both routes work. `IsAuthenticated(token = apiKey)` succeeds, so the API key
*is* a session token and `VerifyLoginApiKey` is an optional extra round trip.

`INVOICE4U_AUTH_MODE=auto` confirms this at startup and reports `direct`.
Setting `INVOICE4U_AUTH_MODE=direct` skips the probe and saves one call.

**Trap found here:** `IsAuthenticated` does **not** return a boolean. It
returns a full `User` object for a good token and `null` for a bad one,
reporting problems through the usual `Errors` array. Code that tests
`result === true` concludes the key is invalid and silently falls through to
the exchange.

### 3. Which field identifies the organisation? — `OrganizationUniqueId`

The company registration number arrives as **`OrganizationUniqueId`** — note
the lower-case `d` — and only from `GetUserData`. `IsAuthenticated` carries
`CompanyName` and `OrganizationID` but not the registration number, so
`connect()` merges both calls.

Observed: Codelovers `OrganizationUniqueId=514781368`, `OrganizationID=12235`.

`INVOICE4U_EXPECT_ORG` still matches against any identifier field, so either
the registration number or the organisation id works.

### 4. `StatusID` values — 1, 2, 3 confirmed

```
1 = פתוחה  (open)
2 = סגורה  (closed)
3 = מזוכית (credited)
```

The API also returns its own Hebrew `Status` string in list results, which is
passed straight through as `status.label`. Codes 4 and 5 were never observed,
so they are still reported as bare numbers rather than guessed.

A third-party integration claims `4 = partially_credited, 5 = cancelled`.
Unverified — do not adopt without seeing it.

### 5. `GetDocuments` paging — windowing, no cursor

`Limit` works; there is no offset or cursor. `invoice4u_list_documents` warns
when a result hits the limit so the caller knows to narrow the window.

### 7. Generating an API key — done

Keys exist for both accounts. The UI path was not needed and remains
undocumented here.

## Still open

### 2. Token lifetime

Unknown. Sessions held for the length of a probe run did not expire, but
nothing long-running has been tested. If tokens do expire, the client needs to
re-authenticate on an `unauthorized` failure and retry once.

With `INVOICE4U_AUTH_MODE=direct` the token is the API key, so this may only
matter for `exchange` mode.

**To settle:** hold a server up for hours and watch for `UnauthorizedUser` on
a call that previously worked.

### 6. Rate limits

Still nothing documented, and nothing was hit during testing.

**To settle:** ask Invoice4U support.

---

## Wire-format findings

Everything below was verified live and is not in the published documentation.

**Collection responses wrap their rows.** `GetDocuments` and
`GetCustomersByOrgId` answer with
`{__type: "CommonCollectionOf…", Errors, Info, OpenInfo, Response: [...]}`,
while `GetBranches` answers with a **bare array**. Both shapes are real;
`unwrapCollection` handles either.

**Request dates must be `/Date(ms)/`.** An ISO-8601 string in a
`DocumentsRequest` makes the service throw and return HTTP 500 with a .NET
stack trace. Response dates come back as `/Date(1737842400000+0200)/`.

**`*Decimal` fields are usually zero.** Across every document in a live
account, `UseDecimalValues` was `null` and every `*Decimal` field was `0`
while the plain field held the real amount. Preferring the decimal twin
unconditionally reports every total as `0.00`. The twin is authoritative only
when `UseDecimalValues` is `true`.

**Operation parameter names**, from the WSDL and confirmed live:

| Operation | Parameters |
|---|---|
| `GetDocument` | `docId`, `token` |
| `GetDocumentByNumber` | `docNumber`, `documentType`, `token` |
| `GetDocumentByApiIdentifier` | `apiIdentifier`, `docType`, `token` |
| `GetFullCustomer` | `id`, `orgID`, `token` |
| `GetCustomerById` | `custId`, `token` |
| `GetDocuments` | `dr`, `token` |
| `GetBranches`, `GetCustomersByOrgId` | `token` |

Note the inconsistency: `documentType` on one, `docType` on another.

**Error codes seen live:** `80 = UnauthorizedUser`, `66 = ExpiredAccount`.

**Currency** comes back as a symbol (`"₪"`), not an ISO code.
