# Open questions

Things not yet confirmed against live Invoice4U data. Each one names what would
settle it. Nothing here is guessed in code — where the answer is unknown, the
server either probes at runtime or reports the raw value rather than inventing
a label.

## 1. Is an API key usable directly as the session token?

**Status:** resolved at runtime, not yet pinned.

The contract offers `VerifyLoginApiKey(apiKey)` and also accepts a `token` on
every call, and the public documentation does not say whether an API key is
itself a token. Probing anonymously cannot tell them apart — a bogus key and a
bogus token both answer `UnauthorizedUser`.

`INVOICE4U_AUTH_MODE=auto` therefore tries the key directly and falls back to
the exchange, and `invoice4u_verify_connection` reports which route won.

**To settle:** run `invoice4u_verify_connection` with a real key and read
`authMode`. Then pin `INVOICE4U_AUTH_MODE` to that value and record it here.

## 2. Token lifetime

Unknown. If tokens expire mid-session, the client needs to re-authenticate on
an `unauthorized` failure and retry once. Not implemented, because it is not
yet known whether it is needed.

**To settle:** hold a session open and watch for `UnauthorizedUser` on a call
that previously succeeded. `GetExpDateByApiKey` exists, so API keys themselves
expire — that is separate from token lifetime and also needs a value.

## 3. Which field identifies the organisation?

**Status:** worked around.

`INVOICE4U_EXPECT_ORG` is compared against *any* identifier field returned by
`GetUserData` (`CompanyNumber`, `OrganizationUniqueID`, `OrganizationID`,
`OrgID`, `UniqueID`, `ID`, `VatNumber`, `CompanyId`, `CompanyID`) rather than
one guessed field.

**To settle:** call `GetUserData` with a real key, record the actual response
shape, and narrow the comparison to the field that genuinely carries the
company number.

## 4. `StatusID` values

**Status:** deliberately not guessed.

The WSDL contains no enum for `StatusID`. A third-party integration uses
`1=open, 2=closed, 3=fully_credited, 4=partially_credited, 5=cancelled`, but it
has never been run against live data. `documentStatusName` returns the raw code
and only adds a name for those five, so an unknown code is reported as a number
rather than mislabelled.

**To settle:** read documents in each known state and record the codes.

## 5. `GetDocuments` paging

`DocumentsRequest` has `Limit` but no offset or cursor, which suggests paging
is done by narrowing the date or number window. `invoice4u_list_documents`
warns when a result hits the limit.

**To settle:** query an account with more documents than the limit and see
whether anything indicates truncation.

## 6. Rate limits

Nothing documented, nothing inferable from the contract.

**To settle:** ask Invoice4U support, or observe under load.

## 7. Generating an API key in the Invoice4U UI

Not documented publicly. Third-party guides all defer to an Invoice4U guide
that needs an account to reach.

**To settle:** find it in the account, or ask Invoice4U support, and document
the path here.
