# invoice4u-mcp

An unofficial [Model Context Protocol](https://modelcontextprotocol.io) server for
**[Invoice4U](https://www.invoice4u.co.il)** (invoice4u.co.il), the Israeli invoicing service.

- **Read-only.** Version 0.1 has no write tools at all — nothing it does can create, change or cancel a document.
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

No tool accepts an account, organisation or business argument.

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
| Document creation, credit invoices, cancellation | Writes with tax consequences; needs the gated, verified write surface. |
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

See [`docs/open-questions.md`](docs/open-questions.md) for what is still unverified against live data.

## License

MIT © Tamir Scherzer. Not affiliated with Invoice4U.
