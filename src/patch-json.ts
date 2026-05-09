/**
 * Apply a JSON Patch (RFC 6902) to a target file with optional sibling schema validation.
 */

import Ajv from 'ajv';
import { applyPatch, validate as validatePatch, type Operation } from 'fast-json-patch';
import { getSchemaPath, readJsonFromFile, writeJsonToFile, fileExists } from './io';
import type { JsonValue } from './core/types';

export interface PatchJsonInput {
  targetPath: string;
  patchPath?: string;
  patchContent?: string;
}

export interface PatchJsonResult {
  targetPath: string;
  patchPath: string | null;
  patchSource: string;
  schemaValidated: boolean;
}

function parseInlinePatch(inlinePatch: string): Operation[] {
  try {
    return JSON.parse(inlinePatch) as Operation[];
  } catch {
    throw new Error('Inline patch must be valid JSON');
  }
}

async function loadPatch({
  patchPath,
  patchContent,
}: PatchJsonInput): Promise<{ patchDocument: Operation[]; patchSource: string }> {
  if (patchPath && patchContent) {
    throw new Error('Provide either patchPath or patchContent, not both');
  }
  if (patchContent) {
    return { patchDocument: parseInlinePatch(patchContent), patchSource: 'inline' };
  }
  if (patchPath) {
    return {
      patchDocument: (await readJsonFromFile(patchPath)) as unknown as Operation[],
      patchSource: patchPath,
    };
  }
  throw new Error('A patch source is required');
}

async function validateAgainstSiblingSchema(
  targetPath: string,
  document: JsonValue,
): Promise<string | null> {
  const schemaPath = getSchemaPath(targetPath);
  if (!(await fileExists(schemaPath))) return null;
  const schema = await readJsonFromFile(schemaPath);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const isValid = ajv.validate(schema as object, document);
  if (!isValid) {
    const details = ajv.errorsText(ajv.errors, { separator: '; ' });
    throw new Error(`Schema validation failed for ${schemaPath}: ${details}`);
  }
  return schemaPath;
}

export async function patchJsonFile(input: PatchJsonInput): Promise<PatchJsonResult> {
  const targetDocument = await readJsonFromFile(input.targetPath);
  const { patchDocument, patchSource } = await loadPatch(input);

  const errors = validatePatch(patchDocument, targetDocument as object);
  if (errors) {
    throw new Error(`Invalid JSON Patch document: ${errors.name || 'validation error'}`);
  }

  const result = applyPatch(structuredClone(targetDocument), patchDocument, true, false)
    .newDocument as JsonValue;
  const schemaPath = await validateAgainstSiblingSchema(input.targetPath, result);
  await writeJsonToFile(input.targetPath, result);

  return {
    targetPath: input.targetPath,
    patchPath: input.patchPath ?? null,
    patchSource,
    schemaValidated: Boolean(schemaPath),
  };
}
