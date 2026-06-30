# JPQ Usage Guide for LLMs

JPQ (JSON Partial Query) is the query format used by `read_json` to read useful slices from one local JSON document without loading the whole file into the answer.

Use JPQ when you need to inspect arrays inside a JSON file with filtering, sorting, paging, nested expansion, or counts. If the user asks for the entire file, use `all: true`.

## Basic Request Shape

```json
{
  "target": "./orders.json",
  "operations": [
    {
      "path": "/items",
      "where": { "field": "/status", "op": "eq", "value": "open" },
      "orderBy": "/datetime DESC, /id ASC",
      "offset": 0,
      "limit": 20
    }
  ]
}
```

Use this shape by default:

- `target`: JSON file path to read.
- `operations`: array of array queries.
- `path`: RFC 6901 JSON Pointer to the array you want.
- `limit`: number of returned items. Default is `5`; use `-1` only when you truly need all matching items.
- `all: true`: return the full document untouched. Do not combine with `operations`.

## Paths

All JPQ paths are JSON Pointers:

| Need | Path |
|---|---|
| Whole document | `""` |
| Top-level `items` array | `"/items"` |
| First order's `lines` array | `"/orders/0/lines"` |
| Key containing `/` | `"/a~1b"` |
| Key containing `~` | `"/m~0n"` |

Inside `where`, `orderBy`, `count.groupBy`, and nested `expand.path`, pointers are relative to the current array element. A leading `/` is optional, but prefer using it for clarity.

For primitive array items, use `"$primitive_value"` or `""` to refer to the item value.

## Filtering

Use `where` to filter array elements before sorting, paging, and counting.

Simple comparison:

```json
{
  "path": "/items",
  "where": { "field": "/amount", "op": "gte", "value": 100 },
  "limit": 10
}
```

Logical expressions:

```json
{
  "path": "/items",
  "where": {
    "and": [
      { "field": "/status", "op": "eq", "value": "open" },
      {
        "or": [
          { "field": "/priority", "op": "eq", "value": "high" },
          { "field": "/amount", "op": "gte", "value": 1000 }
        ]
      }
    ]
  },
  "limit": 20
}
```

Supported comparison operators:

| Operator | Use for |
|---|---|
| `eq`, `ne` | equality / inequality |
| `lt`, `lte`, `gt`, `gte` | numeric, string, or date-like comparisons |
| `in`, `nin` | value is / is not in an array |
| `contains` | string or array contains value |
| `startsWith`, `endsWith` | string prefix / suffix |
| `regex` | regular expression match |
| `exists` | field exists |
| `isNull` | field is null or missing |

Supported logical operators: `and`, `or`, `not`.

## Sorting and Paging

Use `orderBy` as a comma-separated string of relative pointers. Direction defaults to `ASC`.

```json
{
  "path": "/items",
  "orderBy": "/createdAt DESC, /id ASC",
  "offset": 0,
  "limit": 25
}
```

Sorting rules to remember:

- Missing or `null` values sort last for `ASC`.
- Missing or `null` values sort first for `DESC`.
- Commas inside pointer tokens are not supported.

Paging rules:

- `offset` defaults to `0`.
- `limit` defaults to `5`.
- `limit: 0` returns no data items and is useful with `count`.
- `limit: -1` returns all matching items.

## Nested Arrays with `expand`

Use `expand` to slice child arrays inside each returned parent element.

```json
{
  "path": "/orders",
  "where": { "field": "/status", "op": "eq", "value": "open" },
  "limit": 5,
  "expand": [
    {
      "path": "/lines",
      "orderBy": "/sku ASC",
      "limit": 3
    }
  ]
}
```

Nested `expand.path` is relative to each returned parent element. Expanded child arrays are replaced in place with their own sliced results.

## Counts

Use `count: true` to get the number of elements after filtering.

```json
{
  "path": "/items",
  "where": { "field": "/status", "op": "eq", "value": "open" },
  "limit": 0,
  "count": true
}
```

Use grouped counts to bucket matching elements.

```json
{
  "path": "/items",
  "where": { "field": "/amount", "op": "gte", "value": 100 },
  "limit": 0,
  "count": {
    "groupBy": "/status",
    "orderBy": "/count DESC",
    "limit": 10
  }
}
```

Grouped count options:

- `groupBy`: comma-separated relative pointers.
- `orderBy`: sort buckets by `/count` or `/key/<pointer>`.
- `limit`: bucket limit. Default is `-1`.
- `offset`: bucket offset. Default is `0`.
- `nullKey`: value used for missing or null group keys. Default is `null`.

Counts are evaluated after `where` and before the parent operation's sorting and paging.

## Response Shape

The response mirrors the source document. Queried arrays are replaced with the requested slice, and returned elements include provenance metadata.

Object array elements receive `$array_index` when it does not collide with user data:

```json
{ "$array_index": 17, "id": 91, "amount": 250 }
```

Primitive items, arrays, or objects with reserved-key collisions are wrapped:

```json
{ "$array_index": 3, "$primitive_value": "urgent" }
```

`$array_index` is always the original index in the source array before filtering, sorting, or paging.

When counts are requested, they appear in a top-level `$counts` object keyed by operation path:

```json
{
  "items": [],
  "$counts": {
    "/items": { "totalAfterFilter": 312 }
  }
}
```

Per-operation errors appear in a top-level `$errors` object keyed by operation path. Other operations can still succeed.

## Common Query Patterns

Read the first few items of an array:

```json
{
  "target": "./data.json",
  "operations": [
    { "path": "/items", "limit": 5 }
  ]
}
```

Find recent matching records:

```json
{
  "target": "./orders.json",
  "operations": [
    {
      "path": "/orders",
      "where": { "field": "/status", "op": "eq", "value": "open" },
      "orderBy": "/createdAt DESC",
      "limit": 20
    }
  ]
}
```

Count values by category without returning rows:

```json
{
  "target": "./orders.json",
  "operations": [
    {
      "path": "/orders",
      "limit": 0,
      "count": {
        "groupBy": "/status",
        "orderBy": "/count DESC"
      }
    }
  ]
}
```

Query multiple arrays in one request:

```json
{
  "target": "./report.json",
  "operations": [
    { "path": "/items", "limit": 10, "orderBy": "/datetime DESC" },
    { "path": "/errors", "limit": 5 }
  ]
}
```

Filter an array of primitive values:

```json
{
  "target": "./tags.json",
  "operations": [
    {
      "path": "/tags",
      "where": { "field": "$primitive_value", "op": "startsWith", "value": "urgent" },
      "limit": 20
    }
  ]
}
```

## CLI Mapping

JPQ extends the existing `read_json` command.

| JPQ field | CLI option |
|---|---|
| `target` | `--target` / `-t` |
| `all` | `--all` / `-a` |
| `operations[]` | `--parameter` and `--parameter-path` / `-p` |

Existing parameter files remain valid. New fields such as `where`, `expand`, and `count` are optional.

## Error Codes

| Code | Meaning |
|---|---|
| `PATH_NOT_FOUND` | Pointer does not resolve. |
| `PATH_NOT_ARRAY` | Pointer resolves but is not an array. |
| `BAD_POINTER` | Malformed JSON Pointer. |
| `BAD_ORDER_BY` | Invalid `orderBy` string. |
| `BAD_GROUP_BY` | Invalid `groupBy` string. |
| `BAD_FILTER` | Invalid `where` expression. |

## LLM Checklist

Before calling `read_json` with JPQ:

1. Choose `all: true` only when the full untouched document is needed.
2. Otherwise, identify the array path and query that array with `operations`.
3. Keep `limit` small unless the user explicitly needs more data.
4. Use `where` before increasing `limit`.
5. Use `orderBy` when the user asks for latest, earliest, largest, smallest, or stable ordering.
6. Use `count` with `limit: 0` when the user asks how many or asks for a distribution.
7. Use `$array_index` from results when referring back to source array positions.
