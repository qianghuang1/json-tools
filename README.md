# JSON Command Tools

A TypeScript toolkit for reading and patching local JSON files.

It provides:

- `read_json` — CLI for reading a single JSON file using the [JPQ protocol](docs/jpq-protocol.md) (filtering, sorting, paging, count, nested expansion, select projection).
- `patch_json` — CLI for applying a JSON Patch (RFC 6902) to a JSON file with optional sibling-schema validation.
- `json_server` — HTTP server that hosts a directory of JSON files and exposes them through the same JPQ engine.

All three share the same pure JPQ engine, so behavior is identical across the CLI and the server.

## Installation

```bash
npm install
npm run build   # compiles TypeScript to ./dist
```

Run the test suite:

```bash
npm test
```

The published `bin/*.js` scripts call into the compiled output in `./dist`.

## CLI: `read_json`

Reads a JSON file, optionally applying one or more JPQ operations.

```text
read_json -t <target.json>
          [--parameter '<json>'...]
          [-p <ops-file.json>...]
          [-a]
```

| Option | Short | Required | Description |
| --- | --- | --- | --- |
| `--target` | `-t` | Yes | Path to the JSON file. |
| `--parameter` | | No | One or more inline JSON JPQ operation objects. |
| `--parameter-path` | `-p` | No | One or more JSON files whose root is an array of JPQ operations. |
| `--all` | `-a` | No | Returns the document untouched (no `$array_index`, no truncation). Mutually exclusive with parameters. |

The CLI returns the JSON document only. Use the `GET /api/schema/<rel-path>` HTTP endpoint or the library `readJsonFileWithSchema` helper if you also need the sibling schema.

### Example operation file

```json
[
  {
    "path": "/items",
    "select": "/id, /status, /lines",
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
  }
]
```

```bash
read_json -t ./orders.json -p ./read-options.json
```

Inline parameters are validated against a JSON Schema; invalid input produces a readable error message such as:

```
Invalid JPQ request:
  - $.operations[0]: unknown property "bogus"
  - $.operations[0].where.op: must be one of ["eq","ne", ...]
```

See [docs/jpq-protocol.md](docs/jpq-protocol.md) for the full protocol specification, including the `$array_index` / `$primitive_value` provenance rules and the `$counts` / `$errors` output blocks.

`select` is a comma-separated list of relative JSON pointers. For object elements, JPQ returns only selected fields plus mandatory `$array_index`.

## CLI: `patch_json`

Applies a JSON Patch (RFC 6902) document to a target JSON file.

```text
patch_json -t <target.json> (-s <patch.json> | -i '<inline-patch>')
```

| Option | Short | Required | Description |
| --- | --- | --- | --- |
| `--target` | `-t` | Yes | Path to the target JSON file. |
| `--source` | `-s` | No | Path to a JSON Patch file. |
| `--inline` | `-i` | No | Inline JSON Patch document. |

If a sibling `<name>.schema.json` exists, the patched document is validated against it before being written.

```bash
patch_json -t ./config.json -s ./patch.json
patch_json -t ./config.json -i '[{"op":"replace","path":"/name","value":"production"}]'
```

## CLI: `json_server`

Starts an HTTP server that serves every JSON file under a root directory.

```bash
json_server start -t ./data --host 127.0.0.1 --port 3000
```

| Option | Short | Required | Description |
| --- | --- | --- | --- |
| `--target` | `-t` | Yes | Root directory to serve. |
| `--host` | `-h` | No | Bind host (default `127.0.0.1`). |
| `--port` | `-p` | No | Listen port (default `3000`). |
| `--token-file` | | No | Path to a JSON file with sha256-hashed access tokens. When set, every `/api/*` request must present a valid token. |
| `--no-cors` | | No | Disable CORS headers. CORS is enabled by default for browser clients. |
| `--quiet` | | No | Disable request logging. |

### CORS

CORS is enabled by default for browser-based tools. The server allows `GET`, `POST`, and `OPTIONS` requests, accepts the `authorization`, `content-type`, and `x-access-token` headers, and sends `Access-Control-Allow-Credentials: true` for clients using `credentials: "include"`. Use `--no-cors` if you are hosting behind another gateway that owns CORS policy.

### Token authentication

When `--token-file <path>` is provided, the server requires a token on every `/api/*` request. Clients send the raw token via `Authorization: Bearer <token>` (or `x-access-token: <token>`); the server hashes it with SHA-256 and matches against the configured set in constant time.

Token file format:

```json
{
  "accessTokens": [
    {
      "id": "93def96f-5b5d-45dc-9e60-83ec93df43a0",
      "tokenHash": "c1632e0c9f639b23e47fbb4cae9b3c66d87581ab8627457fa6fefa691a0113a8",
      "createdAt": "2026-05-04T11:41:11.786Z"
    }
  ]
}
```

The hash is generated with `sha256(token)` hex-encoded:

```ts
import { hashToken } from 'json-command-tools';
hashToken('my-secret-token'); // => "<sha256-hex>"
```

Responses on auth failure: `401 { "error": "Missing access token" }` (no token), or `403 { "error": "Invalid access token" }` (token did not match).

### HTTP API

| Method & Path | Description |
| --- | --- |
| `GET /api/list` | Lists relative paths to every `*.json` file under the root (excluding `*.schema.json`). |
| `GET /api/json/<rel-path>` | Returns the file's contents. Add `?all=true` to bypass JPQ. |
| `POST /api/json/<rel-path>` | Body is a JPQ request; returns the response document with `$counts` / `$errors` siblings when applicable. |
| `GET /api/schema/<rel-path>` | Returns the file's sibling JSON Schema if present, 404 otherwise. |

Path traversal is blocked. Request bodies are validated against the same JSON Schema used by the CLI; invalid bodies return `400` with a `details` array of human-readable messages.

### Example

```bash
curl -s http://127.0.0.1:3000/api/list
curl -s "http://127.0.0.1:3000/api/json/orders.json?all=true"
curl -s -X POST http://127.0.0.1:3000/api/json/orders.json \
  -H 'content-type: application/json' \
  -d '{
    "operations": [
      {
        "path": "/items",
        "where": { "field": "/status", "op": "eq", "value": "open" },
        "orderBy": "/datetime DESC",
        "limit": 5,
        "count": { "groupBy": "/status" }
      }
    ]
  }'
```

## Library API

The package also exports a programmatic API:

```ts
import {
  executeJpq,
  buildResponseDocument,
  runJpq,
  readJsonFile,
  patchJsonFile,
  buildServer,
  validateJpqRequest,
} from 'json-command-tools';
```

- `executeJpq(document, request)` — pure engine; returns `{ document, counts, errors }`.
- `buildResponseDocument(response)` — bakes `$counts` / `$errors` into the document.
- `runJpq(document, request)` — convenience wrapping the two above with validation.
- `readJsonFile`, `readJsonFileWithSchema` — file-system reads.
- `patchJsonFile` — file-system patch with sibling-schema validation.
- `buildServer({ rootDir, ... })` — returns a configured Fastify instance for embedding.

## Project layout

```
src/
  core/
    types.ts        # JPQ types
    pointer.ts      # RFC 6901 pointer parser/resolver
    filter.ts       # where evaluator
    sort.ts         # orderBy parser/sorter
    count.ts        # count + groupBy
    provenance.ts   # $array_index / $primitive_value injection
    jpq.ts          # main engine (executeJpq)
    schemas.ts      # JSON Schema for JPQ requests
    validate.ts     # AJV-based validation with friendly errors
  io.ts             # JSON file read/write + sibling-schema discovery
  read-json.ts      # high-level read API used by CLI and server
  patch-json.ts     # patch API
  server.ts         # Fastify HTTP server
bin/
  read_json.js      # CLI shim into ./dist
  patch_json.js
  json_server.js
test/
  *.test.ts
docs/
  jpq-protocol.md   # full JPQ specification
```
