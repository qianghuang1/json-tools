/**
 * Read JSON files using the JPQ protocol. Wraps the pure JPQ engine with file I/O
 * and sibling-schema pairing per docs/jpq-protocol.md §8.6.
 */

import { buildResponseDocument, executeJpq, type JpqResponse } from './core/jpq';
import type { JpqOperation, JpqRequest, JsonValue } from './core/types';
import { validateJpqOperations, validateJpqRequest } from './core/validate';
import { readJsonFromFile, readSiblingSchema } from './io';

export interface ReadJsonInput {
  targetPath: string;
  parameterPath?: string;
  parameterPaths?: string[];
  parameters?: JpqOperation[];
  includeAll?: boolean;
}

export interface SchemaEntry {
  path: string;
  type: 'schema';
  content: JsonValue;
}
export interface JsonEntry {
  path: string;
  type: 'json';
  content: JsonValue;
}
export type ReadJsonEntry = SchemaEntry | JsonEntry;

async function loadParameterFiles(parameterPaths: string[]): Promise<JpqOperation[]> {
  const operations: JpqOperation[] = [];
  for (const p of parameterPaths) {
    const content = await readJsonFromFile(p);
    if (!Array.isArray(content)) {
      throw new Error(`Parameter file must contain a JSON array of operations: ${p}`);
    }
    operations.push(...validateJpqOperations(content as unknown[]));
  }
  return operations;
}

/**
 * Run a JPQ request against an in-memory document. Pure — no I/O.
 */
export function runJpq(document: JsonValue, request: JpqRequest): JsonValue {
  const validated = validateJpqRequest(request);
  const response = executeJpq(document, validated);
  return buildResponseDocument(response);
}

/**
 * Run a JPQ request and return the structured response (document + counts + errors).
 */
export function runJpqStructured(document: JsonValue, request: JpqRequest): JpqResponse {
  const validated = validateJpqRequest(request);
  return executeJpq(document, validated);
}

/**
 * Read a JSON file from disk, apply JPQ operations, and return just the document.
 */
export async function readJsonFile(input: ReadJsonInput): Promise<JsonValue> {
  const document = await readJsonFromFile(input.targetPath);

  if (input.includeAll) {
    return runJpq(document, { all: true });
  }

  const parameterPaths = [
    ...(input.parameterPaths ?? []),
    ...(input.parameterPath ? [input.parameterPath] : []),
  ];
  const fileOps = await loadParameterFiles(parameterPaths);
  const inlineOps = input.parameters ? validateJpqOperations(input.parameters) : [];
  const operations = [...inlineOps, ...fileOps];

  return runJpq(document, { operations });
}

/**
 * Read a JSON file with optional sibling schema pairing.
 *
 * Returns an array: schema entry (if present) followed by the JSON entry, matching
 * the existing `read_json` CLI contract.
 */
export async function readJsonFileWithSchema(input: ReadJsonInput): Promise<ReadJsonEntry[]> {
  const schemaEntry = await readSiblingSchema(input.targetPath);
  const document = await readJsonFile(input);
  const entries: ReadJsonEntry[] = [];
  if (schemaEntry) {
    entries.push({ path: schemaEntry.path, type: 'schema', content: schemaEntry.content });
  }
  entries.push({ path: input.targetPath, type: 'json', content: document });
  return entries;
}
