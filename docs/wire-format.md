# Invoice4U wire format

What the API actually does, as opposed to what the documentation says. Every
claim here was verified against the **live production service**, first from the
contract on 2026-09-23 and then against two real accounts the same day.

The published documentation lives on Apiary and **cannot be fetched** — the
page is a JavaScript-only shell and every blueprint URL (`api.apiary.io/blueprint/get/…`,
`jsapi.apiary.io/apis/….apib`) returns HTTP 503. The WSDL in
[`reference/`](reference/) is the substitute, and it is authoritative.

## Transport

Invoice4U is a **.NET WCF service**, not a REST API. One endpoint, 165 operations.

| Environment | Base URL |
|---|---|
| Production | `https://api.invoice4u.co.il/Services/ApiService.svc` |
| QA | `https://apiqa.invoice4u.co.il/Services/ApiService.svc` |

`https://api.invoice4u.co.il/` itself is a stub that redirects to the Apiary docs.

Despite being SOAP-native, there is an ASP.NET ScriptService JSON entry point,
which is what this server uses — no SOAP client needed:

```
POST {baseUrl}/{OperationName}
Content-Type: application/json

{ ...params, "token": "<session token>" }
```

The path variants `…/json/{Op}` and `…/rest/{Op}` return the WCF **HTML help
page**, not JSON. Only the bare `/{Op}` path works, which is why the client
treats an HTML body as "wrong operation path".

## The envelope is `{"d": …}`

Not `{"<Op>Result": …}`. This is the ASP.NET AJAX wrapper:

```console
$ curl -s -X POST https://api.invoice4u.co.il/Services/ApiService.svc/GetTaxRate \
    -H 'Content-Type: application/json' -d '{}'
{"d":{"__type":"Tax:#Invoice.Common",
      "Errors":[{"__type":"CommonError:#Invoice.Common",
                 "Error":"UnauthorizedUser","ID":80,"Paramters":null}],
      "Info":[],"OpenInfo":[],"RecaptchaToken":null,"TaxRate":-1}}
HTTP 200
```

A client built on the `<Op>Result` assumption fails on every single call.

## Failures arrive as HTTP 200

That response above is a **failure**, returned with status 200 and a non-empty
`Errors` array inside the payload. Any client that trusts the status code
reports failures as successes.

Some operations answer with a **bare error string** instead, with no array to
inspect:

```console
$ curl -s -X POST …/GetExpDateByApiKey -d '{"apiKey":"x","token":"x"}'
{"d":"UnauthorizedUser"}
```

Every result object carries `__type`, `Errors`, `Info`, `OpenInfo`. The field
is spelled **`Paramters`** — a typo in the contract itself. Match it exactly.

**Error codes seen live:** `80 = UnauthorizedUser`, `66 = ExpiredAccount`.

## Collection responses wrap their rows

`GetDocuments` and `GetCustomersByOrgId` return

```json
{"__type": "CommonCollectionOf…", "Errors": [], "Info": [], "OpenInfo": [],
 "RecaptchaToken": null, "Response": [ … ]}
```

while `GetBranches` returns a **bare array**. Both shapes are real, so both
have to be handled — see `unwrapCollection` in `src/invoice4u/wire.ts`.

## Request dates must be `/Date(ms)/`

An ISO-8601 string in a `DocumentsRequest` makes the service throw and answer
**HTTP 500** with a .NET stack trace. Responses come back as
`/Date(1737842400000+0200)/`.

## Money: the `*Decimal` twin is usually zero

Every monetary total exists twice — `Total` (double) and `TotalDecimal`
(xs:decimal) — plus a `UseDecimalValues` flag on the document.

The obvious move is to always prefer the decimal, and it is **wrong**. Across
every document in a real account, `UseDecimalValues` was `null` and every
`*Decimal` field was `0` while the plain field carried the real amount.
Preferring the twin unconditionally reports every invoice as `0.00`.

The twin is authoritative only when `UseDecimalValues` is `true`. Items and
payments carry the twins but not the flag — that lives on the parent document.

## Authentication

**The API key is itself a session token.** `IsAuthenticated(token = apiKey)`
succeeds, so `VerifyLoginApiKey` is an optional extra round trip. Both routes
work and both yield a ~1768-character token.

`IsAuthenticated` does **not** return a boolean. It returns a full `User`
object for a good token and `null` for a bad one, reporting problems through
the usual `Errors` array. Code that tests `result === true` concludes every
valid key is invalid.

`GetExpDateByApiKey` returns the same date as the account's `ExpirationDate`,
so API keys do not have a lifetime separate from the account.

## Organisation identity

Neither call alone is enough:

| Call | Gives |
|---|---|
| `IsAuthenticated` | `CompanyName`, `OrganizationID`, `TaxRate`, `IsraelInvoicesConnected`, `ExpirationDate` |
| `GetUserData` | `OrganizationUniqueId` (the registered company number), `OrganizationName` |

Note the casing: **`OrganizationUniqueId`**, lower-case `d`.

## Parameter names

From the contract, confirmed live. Note the inconsistency — `documentType` on
one operation, `docType` on another.

| Operation | Parameters |
|---|---|
| `GetDocument` | `docId`, `token` |
| `GetDocumentByNumber` | `docNumber`, `documentType`, `token` |
| `GetDocumentByApiIdentifier` | `apiIdentifier`, `docType`, `token` |
| `GetFullCustomer` | `id`, `orgID`, `token` |
| `GetCustomerById` | `custId`, `token` |
| `GetDocuments` | `dr`, `token` |
| `GetBranches`, `GetCustomersByOrgId`, `IsAuthenticated`, `GetUserData` | `token` |
| `VerifyLoginApiKey` | `apiKey` |
| `VerifyLogin` | `email`, `password` |
| `GetTaxRate` | `token`, `date` |
| `FetchAllocationNumber` | `docId`, `token` |

## Enumerations

`DocumentType`, from `<EnumerationValue>` annotations in the contract. **11 and
12 do not exist** — `PurchaseOrder` is 13.

| Code | Name | Hebrew |
|---|---|---|
| 1 | `Invoice` | חשבונית מס |
| 2 | `Receipt` | קבלה |
| 3 | `InvoiceReceipt` | חשבונית מס קבלה |
| 4 | `InvoiceCredit` | חשבונית זיכוי |
| 5 | `ProformaInvoice` | חשבון עסקה |
| 6 | `InvoiceOrder` | הזמנה |
| 7 | `InvoiceQuote` | הצעת מחיר |
| 8 | `InvoiceShip` | תעודת משלוח |
| 9 | `Deposits` | הפקדות |
| 10 | `SupplierInvoiceToInventory` | — |
| 13 | `PurchaseOrder` | הזמנת רכש |

`PaymentTypes`: `CreditCard=1, Check=2, MoneyTransfer=3, Cash=4, Credit=5,
WithholdingTax=6, Other=7, Bit=8, PayBox=9`

`ELanguage`: `Hebrew=1, English=2`

`StatusID` has **no enum in the contract**. Confirmed from live documents:
`1 = פתוחה (open)`, `2 = סגורה (closed)`, `3 = מזוכית (credited)`. Codes 4 and 5
were never observed and are not guessed — see [`open-questions.md`](open-questions.md).

Currency comes back as a **symbol** (`"₪"`), not an ISO code.

## `DocumentsRequest`

`GetDocuments(dr, token)` takes a 50-field filter. The useful ones:
`DocumentType`, `DocumentTypes` / `MultipleTypes`, `From` / `To`,
`FromActualCreationDate` / `ToActualCreationDate`, `FromPaymentDueDate` /
`ToPaymentDueDate`, `CustomerID`, `CustomerName`, `FromAmount` / `ToAmount`,
`FromNumber` / `ToNumber`, `ExectDocumentNumber` *(sic)*, `Status`,
`ExtraStatus`, `Currency`, `BranchID`, `PaymentType`, `ItemCode`, `Limit`,
`ItemsIncluded`, `PaymentsIncluded`.

`Limit` works; there is **no offset or cursor**, so paging is done by narrowing
the date or number window. `ItemsIncluded` and `PaymentsIncluded` default off.

## The `Document` object

~120 fields. The ones that shape any integration:

- **Identity** — `ID` (guid), `UniqueID` (guid), `DocumentNumber` (long, sequential **per type**), `ApiIdentifier` (the idempotency key), `DocumentType`, `StatusID`, `Status`
- **Money** — every total twice, plus `UseDecimalValues` (see above)
- **Balances** — `Balance`, `Paid`, `Credit`, `CreditAmount`, `ReceiptAmount`, `Debit`
- **Israeli allocation number** — `AllocationNumber`, `AllocationMessage`, `ForceGenerateAllocationNumber`, `ApprovedNoAllocationNumber`, `IsraelInvoicesDeclineStatus`, `ReverseChargeInvoicesIsrael`
- **Linkage** — `Invoices` (how a receipt links to the invoices it settles), `BaseDocId`, `ReferencedDocNumber`
- **Composition** — `Items`, `Payments`, `Discount`, `BankAccount`, `Attachments`
- **Output** — `PrintOriginalPDFLink`, `PrintCertifiedCopyPDFLink`

The `Customer` record (~60 fields) carries **bank details** (`BankName`,
`BankCode`, `BranchCode`, `AccountNumber`), `CreditCardNumber` and a stored-card
`Token` on the plain record. This server drops all of them.

## Allocation numbers (מספר הקצאה)

Israeli tax invoices above the threshold need an allocation number from the Tax
Authority; without one the invoice is not recognised for the customer's VAT
input deduction. The threshold dropped to **₪5,000** (from ₪10,000) on 1 June.

The API exposes this through `FetchAllocationNumber`, `UpdateAllocationNumber`,
`UserIsraelInvoicesStatus`, and the document fields above. `IsAuthenticated`
reports `IsraelInvoicesConnected`, which says whether the account is wired to
the Tax Authority at all.

Because the API returns HTTP 200 whether or not the number was issued, a
missing allocation number is exactly the kind of failure that hides. Anything
issuing invoices must read `AllocationNumber` back afterwards and treat its
absence as a failure.

## Operations deliberately not used

A cluster of operations is Invoice4U's own internal billing plumbing, not
customer API: `SendMonthlySubscriptionEndsMailV2`,
`MoveTrialExpiredToNotPayingUsersList`, `SetOrganizationExpired`, `GetUWa`,
`GetUWaSund`, `UpdateAKU`, `UpdatePU`, `ServicesExecutionStarted`.

Clearing and card charging (`ProcessCard`, `ProcessApiRequest*`,
`CreateCreditCard`, `AddStandingOrder`) run on the **same** endpoint —
`ClearingApiService.svc` returns 404. They move real money and are out of
scope permanently.

## Prior art

- [`ofersadan85/i4u`](https://github.com/ofersadan85/i4u) — Python, a thin `zeep` SOAP wrapper. Useful for SOAP-level field shapes; the JSON endpoint is the better transport.
- [`agente-dev/invoice4u-mcp`](https://github.com/agente-dev/invoice4u-mcp) — TypeScript MCP server with a well-considered safety design. Its wire layer expects the `<Op>Result` envelope, which production never sends; its own README notes that live integration was "BLOCKED pending credentials", so it was built against fixtures. Not published to npm as of 2026-09-23.
