# Running several Invoice4U accounts

The design question behind this server: one codebase, several Invoice4U
accounts, and no way for an agent to act on the wrong company.

## Two questions, kept apart

They get conflated and they have different answers.

**How is the code reused?** Settled convention: one package, installed per
project. **How does each project get the right account?** This is where the
risk is.

## One process serves exactly one account

**There is no `account`, `organisation` or `business` argument on any tool** —
and adding one is the obvious design that should be resisted.

If the account is a tool argument, the model chooses which company issues an
invoice. A wrong choice is not a bug, it is a **tax event in the wrong
entity's books**. The quieter failure is worse: reading one business's
customers or revenue into a session about another. The API cannot help — a
valid key for the wrong company returns a perfectly successful HTTP 200.

Instead the *project* binds the account, out of band, before the model sees
anything. The model cannot pick wrong because it is never offered the choice.

## The server knows nothing about your businesses

There is no tenant list and no per-account branch anywhere in the code. What
exists is:

- `INVOICE4U_ACCOUNT` — an **arbitrary label**, used only as a Keychain lookup key.
- `INVOICE4U_API_KEY` — the same key supplied directly, for CI or containers.

One key in, whatever organisation that key opens comes out. Adding an account
is one Keychain entry and one config file: **no code change, no release.**

## Project scope, not user scope

| Scope | Stored in | Verdict |
|---|---|---|
| **Project** | `.mcp.json` in the project root | **Use this.** Which account a project belongs to is a fact about the project. |
| User | `~/.claude.json`, all projects | Wrong here — one account would apply to every project you open. |
| Local | `~/.claude.json`, per project path | Fine for experiments; not reproducible. |

MCP clients that expand `${VAR}` in config generally leave an *unset* variable
as the literal text and start the server anyway. The server therefore checks
its own configuration and refuses to start on an unexpanded `${…}` rather than
sending a placeholder to the API as if it were real.

## Keep the key out of the config file

Put the **label** in the committed config and the **key** in the OS keychain:

```bash
security add-generic-password -s invoice4u -a my-business -U -w
```

Putting `-w` last makes `security` prompt, so the key never enters shell
history.

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

The second account is the same file with two values changed.

## Assert the organisation

Configuration alone still fails if the wrong key is filed under the right
label. So when `INVOICE4U_EXPECT_ORG` is set, the server authenticates, reads
the organisation, compares, and **registers no tools at all on a mismatch**:

```
fatal: Organisation mismatch. INVOICE4U_EXPECT_ORG is "99002", but the key
opened "Example Business Ltd" (OrganizationID=99001, OrganizationUniqueId=123456789,
CompanyName=Example Business Ltd). Refusing to start — no tools registered.
Check which key is filed under keychain:invoice4u/my-business.
```

A misfiled key can only refuse to start. It can never act on the wrong company.

The comparison accepts a match on **any** identifier the API returns, so either
the registered company number (`OrganizationUniqueId`) or Invoice4U's own
account id (`OrganizationID`) works.

## Keep the server name the same everywhere

Name it `invoice4u` in every project, not `invoice4u-<business>`. A
tenant-specific name changes the tool names per project and breaks any skill,
command or instruction file that references them — which defeats the point of
a shared server. Visibility comes from the organisation assertion and from
every tool echoing the organisation in its result.

## Where the shared knowledge belongs

The real reuse win is not the HTTP client — it is that the hard-won knowledge
lives in one place: the `{"d": …}` envelope, HTTP-200-with-errors, the
`*Decimal` trap, document type 13, the allocation-number read-back.

That belongs **inside the server**, in its schemas, validation and tool
descriptions — not copied into each project's instruction file, which is the
same drift problem as copying the code.

If guidance needs to travel with it later — a month-end billing skill, a
status command — the current convention is a client **plugin** that bundles
skills, commands and the MCP server together, installed once.

## Layout

```
~/business/
  invoice4u-mcp/          # this repo
  business-one/
    .mcp.json             # INVOICE4U_ACCOUNT=business-one
  business-two/
    .mcp.json             # INVOICE4U_ACCOUNT=business-two
```

One Keychain entry per account, under service `invoice4u`.
