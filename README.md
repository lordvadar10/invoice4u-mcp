# invoice4u-mcp

An unofficial [Model Context Protocol](https://modelcontextprotocol.io) server for
**[Invoice4U](https://www.invoice4u.co.il)** (invoice4u.co.il), the Israeli invoicing service.

- **Drafts are the entire write surface.** It can prepare an unissued draft for review; it cannot issue, cancel or send anything. A draft is not a tax document — no allocation number, no tax consequence — and issuing it stays a human action in Invoice4U.
- **One organisation per process.** The Invoice4U account is chosen by configuration at startup, never by a tool argument. A model cannot pick the wrong company because it is never offered the choice.
- **Account-agnostic.** The server has no notion of your businesses. One API key in, whatever organisation that key opens comes out. Serving a second or tenth account is configuration, not code.
- TypeScript · Node ≥ 20 · stdio · MIT.

> Not affiliated with, endorsed by, or supported by Invoice4U. The name is used only to describe what the server connects to.

## Install

```bash
npm install -g @lordvadar/invoice4u-mcp
```

Or let your MCP client fetch it on demand with `npx` — see below.

## Configure

### 1. Store the API key

On macOS, keep the key in the Keychain so it never lands in a config file, a shell history or a repo. Put `-w` last and `security` prompts for it:

```bash
security add-generic-password -s invoice4u -a my-business -U -w
```

`my-business` here is just a label — the server attaches no meaning to it. Use one label per Invoice4U account.

### 2. Point a project at that account

Add `.mcp.json` to the project root. It contains no secret, so it is safe to commit:

```json
{
  "mcpServers": {
    "invoice4u": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@lordvadar/invoice4u-mcp@^0.1"],
      "env": {
        "INVOICE4U_ACCOUNT": "my-business",
        "INVOICE4U_EXPECT_ORG": "123456789",
        "INVOICE4U_ENV": "production"
      }
    }
  }
}
```

A second business is the same file with a different `INVOICE4U_ACCOUNT` and `INVOICE4U_EXPECT_ORG`. Nothing else changes, and nothing is rebuilt.

Use **project scope**, not user scope. Which Invoice4U account a project belongs to is a fact about the project; a user-scoped server would apply one account to every project you open.

### Environment variables

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `INVOICE4U_ENV` | **yes** | — | `qa` or `production`. No default: production is never selected implicitly. |
| `INVOICE4U_ACCOUNT` | one of | — | Keychain account label holding the API key. |
| `INVOICE4U_API_KEY` | one of | — | The key itself, for CI or containers with no Keychain. |
| `INVOICE4U_EXPECT_ORG` | no | — | Refuse to start unless the key opens this organisation. **Set it when you use more than one account.** |
| `INVOICE4U_ALLOW_WRITES` | no | `false` | Reserved. No write tools exist yet. |
| `INVOICE4U_AUTH_MODE` | no | `auto` | `auto`, `direct` or `exchange`. See below. |
| `INVOICE4U_KEYCHAIN_SERVICE` | no | `invoice4u` | Keychain service name. |
| `INVOICE4U_LOG_LEVEL` | no | `info` | `error`, `warn`, `info`, `debug`. Logs go to stderr. |
| `INVOICE4U_TIMEOUT_MS` | no | `15000` | Per-request timeout. |

## Tools

All read-only, all declaring `readOnlyHint`.

| Tool | Purpose |
|---|---|
| `invoice4u_verify_connection` | Which organisation this server is bound to, how it authenticated, which environment. |
| `invoice4u_list_documents` | Search documents by type, date range, customer, amount. |
| `invoice4u_get_document` | One document in full, by id, by number + type, or by `apiIdentifier`. |
| `invoice4u_check_allocation_status` | Which invoices are **missing their Israeli allocation number**. |
| `invoice4u_list_customers` | List or search customers. |
| `invoice4u_get_customer` | Full contact details, with banking and card data withheld. |
| `invoice4u_list_branches` | Branches of this organisation. |
| `invoice4u_get_tax_rate` | VAT rate in effect on a date. |
| `invoice4u_list_drafts` | Unissued drafts. |
| `invoice4u_get_draft` | One draft in full. |

Write tools, registered **only** when `INVOICE4U_ALLOW_WRITES=true`:

| Tool | Purpose |
|---|---|
| `invoice4u_create_draft` | Prepare an unissued draft. Totals are computed from the line items. |
| `invoice4u_update_draft` | Replace a draft's contents; returns previous and current state. |
| `invoice4u_delete_draft` | Delete an unissued draft. Cannot touch an issued document. |

No tool accepts an account, organisation or business argument.

### Why only drafts

Issuing a tax invoice in Israel is not an undoable act: it can only be reversed
by issuing a credit note, and once it carries an allocation number the Tax
Authority has been told. There is also no Invoice4U sandbox, so any test of a
real issue would write a real document to production.

Drafts sidestep all of that. The agent can do the tedious part — assemble the
lines, get the arithmetic and the VAT right — and a person still decides whether
it becomes a document. Totals are computed from the line items and cannot be
supplied by the caller, so a draft can never claim a total that disagrees with
its own lines.

## Why it is built this way

Invoice4U is a .NET WCF service with a JSON entry point, and three of its behaviours are easy to get wrong. All three were verified against the live production service on 2026-09-23.

**The response envelope is `{"d": …}`**, the ASP.NET ScriptService wrapper — not `{"<Op>Result": …}`. A client built on the wrong assumption fails on every call.

**Failures arrive as HTTP 200.** A business error comes back with status 200 and a non-empty `Errors` array inside the payload; some operations answer with a bare string such as `"UnauthorizedUser"` instead. A non-empty `Errors` array is never treated as success here.

**Money exists twice.** Every total has a `double` and an `xs:decimal` twin (`Total` / `TotalDecimal`). The decimal is always preferred and money crosses the tool boundary as a string, so nothing drifts on agorot.

### Allocation numbers (מספר הקצאה)

Israeli tax invoices above the threshold need an allocation number from the Tax Authority, and without one the invoice is not recognised for the customer's VAT input deduction. Because the API returns HTTP 200 whether or not the number was issued, a missing allocation number is exactly the kind of failure that hides.

Every document returned by this server carries its allocation status explicitly, and `invoice4u_check_allocation_status` exists to sweep a date range for invoices that are missing one.

### Organisation assertion

Configuration alone still fails if the wrong key is filed under the right label. So when `INVOICE4U_EXPECT_ORG` is set, the server authenticates, reads the organisation, compares, and **registers no tools at all on a mismatch**. A misfiled key can only refuse to start — it can never act on the wrong company.

### Authentication

Invoice4U's public documentation does not say whether an API key is itself a session token or must be exchanged through `VerifyLoginApiKey`. Rather than assume, `INVOICE4U_AUTH_MODE=auto` (the default) tries the key directly against `IsAuthenticated` and falls back to the exchange. `invoice4u_verify_connection` reports which route won. Pin it with `direct` or `exchange` once you know.

## Safety

- Read-only: there is no code path that writes to Invoice4U.
- The API key is never a tool argument, never in a URL, never logged, and is redacted from any error that escapes.
- Only two hosts are ever contacted (`api.` and `apiqa.invoice4u.co.il`). There is no base-URL override.
- Customer bank details, credit-card numbers and stored-card tokens are dropped from all output.
- Writes, when they arrive, will be gated, idempotent and verified by read-back. Money-moving operations — card charging, stored cards, standing orders — are out of scope permanently.

## Not implemented

Deliberately excluded, with reasons:

| Area | Why |
|---|---|
| Clearing, card charging, stored cards, standing orders | Moves real money. |
| Issuing real invoices and receipts | Not undoable except by a credit note, and reported to the Tax Authority once an allocation number attaches. Drafts cover the useful part without the risk. |
| Credit invoices, cancellation, status changes | Destructive writes on issued documents. |
| Sending documents by email | Outward-facing and not recallable. |
| Customer deletion | Permanent and destructive. |
| Inventory, suppliers | Out of scope for an accounting-data server. |
| A generic passthrough tool | Would undermine the typed, allowlisted surface. |

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Documentation

| Doc | What |
|---|---|
| [`docs/wire-format.md`](docs/wire-format.md) | What the API actually does — envelopes, errors, money, dates, enums, parameter names. Verified against production. |
| [`docs/multi-account.md`](docs/multi-account.md) | Running several Invoice4U accounts without an agent ever acting on the wrong company. |
| [`docs/open-questions.md`](docs/open-questions.md) | What is still unverified, and what would settle it. |
| [`docs/reference/`](docs/reference/) | The production WSDL and all 165 operation names. |

## License

MIT © Tamir Scherzer. Not affiliated with Invoice4U.
