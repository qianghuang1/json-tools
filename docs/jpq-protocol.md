# JPQ — JSON Partial Query Protocol

**Status:** Draft v0.7
**Scope:** Read-only, single-document, single-user querying of local JSON files.

JPQ is a small, GraphQL-inspired protocol for reading **slices** of a single JSON document. It supports filtering, sorting, paging, truncation, and counting on any array within the document, while keeping the response as close to the original document shape as possible.

The protocol is designed to extend the existing `read_json` command in this repository. Complex relational data should use a database — JPQ intentionally stays small.

---

## 1. Goals and Non-Goals

### Goals

- Read partial slices of a single JSON document.
- Apply **filter**, **sort**, **paging**, **truncation**, and **count** to any array within the document.
- Preserve provenance: every returned array element carries its original index.
- Keep the response shape **as close to the original document as possible** — only queried arrays are sliced; only `$array_index` hints are added.
- Stay small and predictable.

### Non-Goals

- No projection / field selection (return elements as-is).
- No cross-document joins. Use a database for relational workloads.
- No mutations (use `patch_json` for that).
- No remote sources, no streaming, no aggregations beyond `count`.

---

## 2. Path Syntax — RFC 6901 JSON Pointer

All paths are RFC 6901 JSON Pointers.

- A path is zero or more `/`-prefixed reference tokens. `""` = document root.
- Token escaping: `~` → `~0`, `/` → `~1`. Unescape `~1` first, then `~0`.
- Array indices: non-negative integers without leading zeros. The `-` token (one-past-the-end) is **not** allowed for reads.

| Intent | Path |
|---|---|
| Whole document | `""` |
| Top-level `items` array | `/items` |
| First order's lines | `/orders/0/lines` |
| Key `a/b` | `/a~1b` |
| Key `m~n` | `/m~0n` |

Inside `where`, `orderBy`, `groupBy`, and nested `expand.path`, pointers are **relative to the current array element** (a leading `/` is optional). For wrapped primitive elements (see §6), the literal token `$primitive_value` refers to the element value itself.

---

## 3. Request Shape

```json
{
  "target": "./orders.json",
  "all": false,
  "operations": [
    {
      "path": "/items",
      "where": {
        "and": [
          { "field": "/status", "op": "eq", "value": "open" },
          { "field": "/amount", "op": "gte", "value": 100 }
        ]
      },
      "orderBy": "/datetime DESC, /id ASC",
      "offset": 0,
      "limit": 20,
      "expand": [
        { "path": "/lines", "limit": 3, "orderBy": "/sku ASC" }
      ],
      "count": { "groupBy": "/status" }
    },
    { "path": "/errors", "limit": 10 }
  ]
}
```

- `all: true` returns the full document untouched and is mutually exclusive with `operations`.

---

## 4. Operation Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `path` | RFC 6901 pointer | `""` | Must resolve to an array. |
| `where` | filter expression | none | See §5. |
| `orderBy` | string | none | Comma-separated `<pointer> [ASC\|DESC]` keys, applied left-to-right. Direction defaults to `ASC`. Missing/`null` values sort last for `ASC`, first for `DESC`. |
| `offset` | int ≥ 0 | 0 | |
| `limit` | int | 5 | `-1` = unlimited. `0` = data omitted (count-only when paired with `count`). |
| `expand` | Operation[] | [] | Nested operations against child arrays of each returned element. |
| `count` | bool \| object | `false` | See §7. |

### `orderBy` grammar

```
orderBy   := key ("," key)*
key       := pointer (WS direction)?
direction := "ASC" | "DESC"   ; case-insensitive
pointer   := relative RFC 6901 pointer (leading "/" optional)
```

Whitespace around commas and between pointer and direction is ignored. Commas inside pointer tokens are not supported in v1.

---

## 5. Filter (`where`)

```json
{
  "and": [
    { "field": "/status", "op": "eq", "value": "open" },
    { "or": [
      { "field": "/amount",   "op": "gte", "value": 100 },
      { "field": "/priority", "op": "in",  "value": ["high", "urgent"] }
    ]}
  ]
}
```

- **Comparison operators:** `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains`, `startsWith`, `endsWith`, `regex`, `exists`, `isNull`.
- **Logical operators:** `and`, `or`, `not`.
- `field` is a relative pointer into the current element. For wrapped elements, use `$primitive_value` (or the empty string `""`) to refer to the element value.
- `regex` engines should impose a timeout to guard against catastrophic backtracking.

---

## 6. Provenance Rule

The response mirrors the source document. The only metadata added per element is `$array_index`. The engine attaches it non-destructively:

```
if element is a plain object
   AND "$array_index" is not already an own key
   AND "$primitive_value" is not already an own key:
      add "$array_index" to element
else:
      replace element with { "$array_index": <i>, "$primitive_value": <element> }
```

This means:

- **Plain objects** receive a single extra key. The rest of the object is untouched.
- **Primitives** (`string`, `number`, `boolean`, `null`), **arrays**, and objects that would clash are wrapped under `$primitive_value` so the original value survives verbatim.
- `$array_index` always reflects the element's original position in its parent array, **before** filter / sort / paging.

There is no opt-out: the protocol always emits `$array_index`, and chooses the cheapest non-lossy carrier.

### Examples

**Object element (common case):**

```json
{ "$array_index": 17, "id": 91, "amount": 250 }
```

**Primitive element:**

```json
{ "$array_index": 3, "$primitive_value": "urgent" }
```

**Object whose user data already uses a reserved key:**

```json
{ "$array_index": 9, "$primitive_value": { "$array_index": "user-supplied", "id": 1 } }
```

---

## 7. Count Aggregation

`count` may be a boolean or an object.

| Field | Type | Default | Notes |
|---|---|---|---|
| `groupBy` | string | none | Comma-separated relative pointers. Each combination of values becomes one bucket. |
| `orderBy` | string | none | Sort buckets by `/key/<pointer>` or `/count`, same direction grammar as §4. |
| `limit` | int | -1 | Cap returned buckets. `-1` = all. |
| `offset` | int ≥ 0 | 0 | |
| `nullKey` | any | `null` | Value used in `key` when a `groupBy` pointer is missing/`null`. |

`count: true` is shorthand for "ungrouped count" — only `totalAfterFilter` is reported. Without `groupBy`, the object form is equivalent.

Counts are evaluated **after** `where` and **before** the parent operation's `orderBy` / `offset` / `limit`, so the data slice and the counts always agree on the filtered universe.

Group keys are compared by strict equality on extracted values; objects/arrays as keys are stringified via canonical JSON to keep buckets deterministic.

Counts are emitted in a top-level `$counts` block (see §8.3).

---

## 8. Response Shape

The response **mirrors the source document**. The engine only:

1. Replaces queried arrays with their filtered / sorted / paged slice.
2. Adds `$array_index` to each surviving element per the rule in §6.
3. Optionally adds top-level `$counts` and `$errors` blocks.

There is no per-operation envelope. There is no `$pointer`. There is no `$expand` map — child arrays are sliced **in place** inside the returned elements.

### 8.1 Basic example

**Source (`orders.json`):**

```json
{
  "name": "prod",
  "items": [ { "id": 1 }, { "id": 2 }, { "id": 3 } ],
  "errors": [ "x", "y" ]
}
```

**Request:**

```json
{
  "operations": [
    { "path": "/items",  "limit": 2, "orderBy": "/id DESC" },
    { "path": "/errors", "limit": 1 }
  ]
}
```

**Response:**

```json
{
  "name": "prod",
  "items": [
    { "$array_index": 2, "id": 3 },
    { "$array_index": 1, "id": 2 }
  ],
  "errors": [
    { "$array_index": 0, "$primitive_value": "x" }
  ]
}
```

### 8.2 Nested `expand`

Child arrays inside returned elements are sliced in place:

```json
{
  "$array_index": 0,
  "id": 1,
  "lines": [
    { "$array_index": 0, "sku": "A-1" },
    { "$array_index": 1, "sku": "A-2" }
  ]
}
```

### 8.3 `$counts`

When at least one operation requests `count`, a top-level `$counts` block is appended, keyed by the operation's absolute pointer:

```json
{
  "items":  [ ... ],
  "errors": [ ... ],
  "$counts": {
    "/items":  { "totalAfterFilter": 312 },
    "/errors": {
      "totalAfterFilter": 2,
      "groupBy": "$primitive_value",
      "buckets": [
        { "key": { "$primitive_value": "x" }, "count": 1 },
        { "key": { "$primitive_value": "y" }, "count": 1 }
      ]
    }
  }
}
```

- Ungrouped requests carry only `totalAfterFilter`.
- Grouped requests add `groupBy` and `buckets`.
- `$counts` is omitted entirely when no operation requested counts.

### 8.4 `$errors`

Per-operation errors live in a top-level `$errors` block, keyed by the operation's absolute pointer:

```json
{
  "items": [ ... ],
  "$errors": {
    "/missing/path": { "code": "PATH_NOT_FOUND", "message": "Pointer /missing does not exist." }
  }
}
```

Errors are scoped per operation; siblings still execute. `$errors` is omitted when empty.

### 8.5 Reserved-key collision at the document root

If the source document already has a top-level `$counts`, `$errors`, or `$primitive_value` key, the engine wraps the entire document the same way as a colliding element:

```json
{ "$primitive_value": <original document>, "$counts": { ... }, "$errors": { ... } }
```

### 8.6 Schema pairing

When a sibling `*.schema.json` exists beside the target, its contents are emitted as a separate top-level entry **before** the document — matching the existing `read_json` behavior. The document portion follows the rules above.

### 8.7 `--all` / `all: true`

Returns the full document **untouched** — no `$array_index` injection, no slicing, no `$counts` / `$errors`. True round-trip of the source.

---

## 9. Errors

| Code | When |
|---|---|
| `PATH_NOT_FOUND` | Pointer does not resolve. |
| `PATH_NOT_ARRAY` | Pointer resolves but is not an array. |
| `BAD_POINTER` | Malformed RFC 6901 pointer. |
| `BAD_ORDER_BY` | `orderBy` string fails to parse. |
| `BAD_GROUP_BY` | `groupBy` string fails to parse. |
| `BAD_FILTER` | `where` expression invalid. |

---

## 10. Defaults & Safety

- Default `limit` = 5 (matches existing `read_json`).
- `--all` / `all: true` cannot combine with operations or filters.
- Single-document scope only — no projection, no joins, no mutations.

---

## 11. CLI Mapping (backward-compatible with `read_json`)

| JPQ field | CLI option |
|---|---|
| `target` | `--target` / `-t` |
| `all` | `--all` / `-a` |
| `operations[]` | `--parameter` and `--parameter-path` / `-p` |

Existing parameter files stay valid; `path` values just need to switch from `items` to `/items`. New fields (`where`, `expand`, `count`) are all optional.

---

## 12. Comparison to GraphQL

| Concern | GraphQL | JPQ |
|---|---|---|
| Schema source | Server-defined SDL | Optional sibling JSON Schema |
| Resolution | Field resolvers | Pointer into existing JSON tree |
| Shape control | Selection set | None — elements returned as-is |
| List control | Connection args | `where`, `orderBy`, `offset`, `limit` |
| Aggregation | Resolver-defined | Built-in `count` / `groupBy` |
| Provenance | Not built-in | `$array_index` (with `$primitive_value` wrapping) |
| Mutations | Yes | No (use `patch_json`) |
| Cross-source | Federation | Out of scope by design |
| Response shape | Caller-defined | Mirrors source document |

---

## 13. Design Decisions Log

This section records the choices made during design so future revisions can revisit them with context.

1. **RFC 6901 JSON Pointer** chosen over dotted paths for unambiguity.
2. **Comma-separated string** chosen for multi-key `orderBy` over array form, for terseness in CLI parameter files.
3. **Cross-document joins removed.** Complex relational data should use a database, not JSON.
4. **`select` / projection removed.** Single-user, single-document scope means no perf pressure to trim fields; keeping elements as-is preserves shape fidelity.
5. **`$primitive_value` wrapping** chosen over always-wrap or skip-provenance, so object responses stay clean while primitives still carry indices.
6. **No provenance opt-out.** Always emit `$array_index`; choose the cheapest non-lossy carrier.
7. **Response mirrors the source document.** No envelope around sliced arrays; metadata (`$counts`, `$errors`) lives in top-level sibling keys.
8. **`$pointer` removed** from elements — structural position in the response already encodes it.

---

## 14. Open Questions

- Streaming / NDJSON for very large results.
- Whether to admit `sum` / `min` / `max` aggregations in a future revision.
