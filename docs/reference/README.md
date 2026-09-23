# Reference material

| File | What |
|---|---|
| `ApiService.wsdl` | The full production service contract, pulled 2026-09-23. This is the authoritative description of the API — the published Apiary documentation is a JavaScript-only shell that cannot be fetched, and every blueprint URL returns HTTP 503. |
| `operations.txt` | All 165 operation names from that contract. |

Re-pull the contract with:

```bash
curl -s 'https://api.invoice4u.co.il/Services/ApiService.svc?singleWsdl' \
  -o docs/reference/ApiService.wsdl
```

Useful extractions:

```bash
# every operation name
grep -o '<wsdl:operation name="[^"]*"' docs/reference/ApiService.wsdl \
  | sed 's/.*name="//;s/"//' | sort -u

# an operation's parameters
python3 - <<'PY'
import re
x = open('docs/reference/ApiService.wsdl', encoding='utf-8').read()
op = 'GetDocumentByNumber'
m = re.search(rf'<xs:element name="{op}">(.*?)</xs:element>', x, re.S)
for n, t in re.findall(r'<xs:element[^>]*name="([^"]+)"[^>]*type="([^"]+)"', m.group(1)):
    print(f'{n}: {t}')
PY
```

Enum values live in `<EnumerationValue>` annotations, which is where the
`DocumentType` codes in `src/invoice4u/enums.ts` come from.
