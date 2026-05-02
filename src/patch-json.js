const fs = require('node:fs/promises');
const Ajv = require('ajv');
const { applyPatch, validate } = require('fast-json-patch');
const { getSchemaPath, readJsonFromFile, writeJsonToFile } = require('./json-utils');

function parseInlinePatch(inlinePatch) {
  try {
    return JSON.parse(inlinePatch);
  } catch {
    throw new Error('Inline patch must be valid JSON');
  }
}

async function loadPatchDocument({ patchPath, patchContent }) {
  if (patchPath && patchContent) {
    throw new Error('Provide either patchPath or patchContent, not both');
  }

  if (patchContent) {
    return {
      patchDocument: parseInlinePatch(patchContent),
      patchSource: 'inline',
    };
  }

  if (patchPath) {
    return {
      patchDocument: await readJsonFromFile(patchPath),
      patchSource: patchPath,
    };
  }

  throw new Error('A patch source is required');
}

async function validateAgainstSiblingSchema(targetPath, document) {
  const schemaPath = getSchemaPath(targetPath);

  try {
    await fs.access(schemaPath);
  } catch {
    return null;
  }

  const schema = await readJsonFromFile(schemaPath);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const isValid = ajv.validate(schema, document);

  if (!isValid) {
    const details = ajv.errorsText(ajv.errors, { separator: '; ' });
    throw new Error(`Schema validation failed for ${schemaPath}: ${details}`);
  }

  return schemaPath;
}

async function patchJsonFile({ targetPath, patchPath, patchContent }) {
  const targetDocument = await readJsonFromFile(targetPath);
  const { patchDocument, patchSource } = await loadPatchDocument({ patchPath, patchContent });

  const errors = validate(patchDocument, targetDocument);
  if (errors) {
    throw new Error(`Invalid JSON Patch document: ${errors.name || 'validation error'}`);
  }

  const result = applyPatch(structuredClone(targetDocument), patchDocument, true, false).newDocument;
  const schemaPath = await validateAgainstSiblingSchema(targetPath, result);

  await writeJsonToFile(targetPath, result);

  return {
    targetPath,
    patchPath: patchPath || null,
    patchSource,
    schemaValidated: Boolean(schemaPath),
  };
}

module.exports = {
  loadPatchDocument,
  patchJsonFile,
  validateAgainstSiblingSchema,
};