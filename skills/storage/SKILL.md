---
name: storage
description: Store, save, record, or persist structured data as schema-backed JSON under the default ~\.agent-storage\**\** tree. Use when the user wants durable records, logs, datasets, or repeatable memory-like data.
---

# Structured Data Storage Skill

Store, save, record, or persist information as structured JSON data. This skill is for durable, repeatable records and datasets, with schemas kept beside the data so future reads and writes stay predictable.

Default storage root: `~\.agent-storage\**\**`

Use subfolders under `~\.agent-storage` to group related domains, for example:

- `~\.agent-storage\personal\feeding-log.json`
- `~\.agent-storage\work\projects.json`
- `~\.agent-storage\research\sources.json`

Each JSON data file should have a sibling JSON Schema file using the same basename:

- `feeding-log.json`
- `feeding-log.schema.json`

### 1. Storage Model

Store everything as structured JSON:

- **Repeated records**: Use an object with an array field such as `items`, `records`, `entries`, or the domain name.
- **Single structured state**: Use an object with named fields and metadata.
- **Freeform text from the user**: Store it as a string field inside a structured JSON record, with useful metadata such as `createdAt`, `source`, `tags`, or `summary` when applicable.
- **Schemas**: Create or maintain a sibling `.schema.json` file with `title` and `description` fields. Keep data and schema in sync.

### 2. Assessment Workflow

- **Inspect first**: Do not blindly create files. Inspect `~\.agent-storage` and the relevant subfolder first.
- **Read indexes when present**: If a `directory.md` exists in the target folder, read it first. It summarizes child files from metadata such as `title` and `description` in `.schema.json` files. Do not edit `directory.md` manually.
- **Prefer updating**: Patch an existing matching JSON file instead of creating a new one when the stored concept already exists.
- **Design the smallest useful schema**: Capture the fields needed for reliable future reads, but avoid over-modeling uncertain data.

### 3. Execution Rules

- Read the sibling schema file first when it exists.
- Use `read_json` via terminal to inspect JSON data, especially arrays or large files.
- Use `patch_json` via terminal for updates to avoid full rewrites and to trigger sibling schema validation.
- Use file write tools only for creating new JSON files, creating or updating schema files, or writing temporary patch/parameter files.
- Keep JSON data and schemas valid after every write.
- If `directory.md` indexes exist, treat them as generated. Do not update them manually.
- Use `build-storage` to regenerate `directory.md` for a storage root after creating, moving, or removing storage files.

### 4. Storage Management

When the user asks to store something:

- Identify the durable entity being recorded.
- Choose or create a domain folder under `~\.agent-storage`.
- Reuse an existing schema-backed JSON file when it matches the entity.
- Add timestamps for event-like records. Use the current time tool when the user refers to now, today, just happened, or a relative time.
- Preserve user-provided facts exactly where precision matters, and normalize only fields that improve retrieval, sorting, or validation.
- If the information is truly one-off or narrative, still store it as a structured JSON record with a text field rather than creating a separate unstructured storage area.

### 5. Final Output

Keep writes minimal, preserve the workspace organization, and return a concise summary of exactly what was saved and where.

### 6. Repeatable Behavior

When the user requests a repeatable logging or tracking behavior, model it as structured storage so future entries can be appended consistently. Keep it organized and easy to retrieve later instead of dumping unrelated records into one file.

### 7. Temp Files

Use `.tmp` under the current working directory for temporary files that are only needed during the current conversation, such as JSON Patch files or read parameter files. This keeps them separate from persistent storage and makes it clear they can be discarded after use.

### Reading Hints

** SUPER IMPORTANT:** 

- Avoid using the `-a` option to read an entire data file unless it is small or you have already inspected it with parameters. Schema files are usually safe to read entirely.
- Avoid using `file_read` to inspect JSON data directly when a schema file exists. Read the schema first, then use `read_json` with sorting, filtering, projection, and truncation parameters.
- Avoid using file write tools to update JSON data directly. Prefer `patch_json`.

JSON files might be very large, so avoid reading them directly with `file_read` if a schema file exists. Read the schema first, then use `read_json` with sort and truncation parameters via the terminal.

Refer to `~\.agent-storage\JSONCheatReadParamters\[namehint].json` to see if saved parameter files are available (`namehint` = `[json name] + [hint]`). If not, persist useful read options there for future reuse.

### Storage Directory Index

Use `build-storage` to generate or refresh a `directory.md` table for the storage root. The default target is `~\.agent-storage`.

```bash
build-storage
build-storage -t ~/.agent-storage
build-storage --target ./storage
```

The generated table contains each storage file's name, description, and relative path. Names link to the JSON storage file. Sibling `.schema.json` files provide the preferred `title` and `description` metadata.

### Skill Copy

Use `skill copy` to copy this package's `skills` folder into another folder. The default target is the current working directory.

```bash
skill copy
skill copy ./target-folder
skill copy ./target-folder --force
```

---

## JSON Command Tools Reference

`read_json` and `patch_json` are globally installed. Run them via the `terminal` tool. Use them to interact with JSON.

### `patch_json`

Applies a JSON Patch (RFC 6902) to a target JSON file. If a sibling `.schema.json` file exists (e.g. `config.schema.json` beside `config.json`), the patched result is validated automatically.

#### Usage

| Option | Short | Required | Description |
| --- | --- | --- | --- |
| `--target` | `-t` | Yes | Path to the target JSON file to update. |
| `--source` | `-s` | No | Path to a file containing the JSON Patch document. |
| `--inline` | `-i` | No | Inline JSON Patch document. |

Provide either `--source` or `--inline`, but not both. Prefer `--source` (write the patch to a temp file first) to avoid shell-escaping issues.

#### Examples

**Patch from file** — write the patch array to a file, then apply:

```bash
patch_json -t ./config.json -s ./patch.json
```

where `patch.json` contains:

```json
[
	{ "op": "replace", "path": "/name", "value": "production" },
	{ "op": "add", "path": "/features/logging", "value": true }
]
```

**Patch from inline JSON:**

```bash
patch_json -t ./config.json -i '[{"op":"replace","path":"/name","value":"production"}]'
```

### `read_json`

Reads a JSON file with optional schema-first output, array paging, and sorting. Useful when the file is too large to inspect as a whole.

#### Usage

| Option | Short | Required | Description |
| --- | --- | --- | --- |
| `--target` | `-t` | Yes | Path to the JSON file to read. |
| `--parameter` | | No | One or more inline JSON objects describing array read options. |
| `--parameter-path` | `-p` | No | One or more JSON file paths containing arrays of read option objects. |
| `--all` | `-a` | No | Read the entire file without truncating arrays. Cannot combine with parameter filters. |

#### Parameter format

Each parameter object targets one array:

| Field | Description |
| --- | --- |
| `path` | Path to the array, e.g. `items`. |
| `limit` | Max items to return. `< 0` means no limit. |
| `orderBy` | Sort field. Append ` ASC` or ` DESC` for direction. |
| `offset` | Starting index for paging. |

#### Default behavior

- Arrays are truncated to 5 items by default.
- `$array_index` is added to each object item to show its original position.
- If a sibling `.schema.json` exists, the schema is emitted first.

#### Examples

**Read entire file:**

```bash
read_json -t ./orders.json -a
```

**Read with parameter file:**

```bash
read_json -t ./orders.json -p ./read-options.json
```

where `read-options.json` contains:

```json
[
	{ "path": "items", "limit": 20, "orderBy": "datetime DESC", "offset": 0 }
]
```

## Projection with `select`

Use `select` to return only specific fields from each element, reducing noise when objects are large.

```json
{
  "path": "/orders",
  "select": "/id, /status, /amount",
  "limit": 10
}
```

see more in [JPQ Usage Guide](./references/read_json.md).

**Read with inline parameter:**

```bash
read_json -t ./orders.json --parameter '{"path":"items","orderBy":"datetime DESC","limit":5}'
```

whenever use inline paramter, try to use single quotes for the whole JSON string, and double quotes for the fields inside, to avoid shell escaping issues. Or you can write the parameter to a temp file and use `--parameter-path` option to read it.

### Installation
If you failed to find the json tools
```bash
npm i -g json-command-tools
```