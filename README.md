# JSON Command Tools

JSON Command Tools is a Node.js command-line project for reading and updating JSON files on the local file system. It is intended for operational tasks such as inspecting large JSON documents, applying targeted updates, and validating data against a matching JSON Schema when available.

## Overview

This project currently provides two commands:

- `patch_json`: updates a JSON file using a JSON Patch document.
- `read_json`: reads large JSON files with optional paging and sorting controls.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Run the commands from the project directory with `npx`:

```bash
npx patch_json -t ./config.json -s ./patch.json
npx read_json -t ./orders.json -p ./read-options.json
```

## Command Reference

### `patch_json`

Applies a JSON Patch to a target JSON file.

The patch must be provided through a patch file.

If a schema file exists beside the target file using the same base name and the `.schema.json` suffix, the updated JSON will be validated automatically.

Example:

- target file: `config.json`
- schema file: `config.schema.json`

#### Parameters

| Option | Short | Required | Description |
| --- | --- | --- | --- |
| `--target` | `-t` | Yes | Path to the target JSON file to update. |
| `--source` | `-s` | Yes | Path to a file containing the JSON Patch document. |

#### Notes

- The patch format is expected to follow the JSON Patch standard (RFC 6902).
- Inline JSON content is not supported.
- Using a patch file avoids shell-escaping and encoding issues in PowerShell and other command shells.

#### Example: patch from file

Patch file `patch.json`:

```json
[
	{ "op": "replace", "path": "/name", "value": "production" },
	{ "op": "add", "path": "/features/logging", "value": true }
]
```

Command:

```bash
patch_json -t ./config.json -s ./patch.json
```

#### Example: schema validation

If the following files exist in the same directory:

```text
config.json
config.schema.json
```

then `patch_json` will validate the patched result against `config.schema.json` before completion.

### `read_json`

Reads JSON files, with support for large arrays through filtering, paging, and sorting.

This command is useful when the full document is too large to inspect comfortably but only part of the data is needed.

#### Parameters

| Option | Short | Required | Description |
| --- | --- | --- | --- |
| `--target` | `-t` | Yes | Path to the target JSON file. |
| `--parameter` | `-p` | No | Path to a JSON file describing how to read array content, including path, limit, ordering, and offset. |
| `--all` | `-a` | No | Reads the entire JSON document without truncating arrays. |

#### `--parameter` format

The `--parameter` value must be a path to a JSON file. That file contains a JSON object with the read options. Supported fields include:

| Field | Description |
| --- | --- |
| `path` | Path to the array to inspect, for example `items`. |
| `limit` | Maximum number of items to return. If `limit < 0`, all items are returned. |
| `orderBy` | Field name used for sorting. |
| `offset` | Starting index for paging. |

Example:

```json
{
	"path": "items",
	"limit": 20,
	"orderBy": "datetime",
	"offset": 0
}
```

Example file:

- `read-options.json`

#### Default behavior

- By default, arrays are truncated to 200 items.
- If `--all` is provided, the full JSON document is returned.
- If `limit` is less than `0`, the selected array is returned without a length restriction.
- Inline JSON content is not supported for `--parameter`.

#### Example: read the entire file

```bash
read_json -t ./orders.json -a
```

#### Example: read a portion of an array

```bash
read_json -t ./orders.json -p ./read-options.json
```

#### Example scenario

Given this input file:

```json
{
	"items": [
		{ "id": 1, "datetime": "2026-04-18T09:00:00Z" },
		{ "id": 2, "datetime": "2026-04-18T10:00:00Z" },
		{ "id": 3, "datetime": "2026-04-18T11:00:00Z" }
	]
}
```

This command:

```bash
read_json -t ./orders.json -p ./read-options.json
```

returns the first two sorted items from `items`.

## Usage Guidance

- Use `patch_json` when you need deterministic, auditable updates to an existing JSON document.
- Use `read_json` when the JSON file is too large to inspect as a whole or when only a slice of an array is needed.
- Keep schema files beside the corresponding target files if validation is required.

## Future Documentation Improvements

If this project grows, the README should also document:

- installation steps
- executable entry points
- exit codes
- error messages
- sample input and output files
