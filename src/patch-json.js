const fs = require('node:fs/promises');
const Ajv = require('ajv');
const { applyPatch, validate } = require('fast-json-patch');
const { getSchemaPath, readJsonFromFile, writeJsonToFile } = require('./json-utils');

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

async function patchJsonFile({ targetPath, patchPath }) {
  const targetDocument = await readJsonFromFile(targetPath);
  const patchDocument = await readJsonFromFile(patchPath);

  const errors = validate(patchDocument, targetDocument);
  if (errors) {
    throw new Error(`Invalid JSON Patch document: ${errors.name || 'validation error'}`);
  }

  const result = applyPatch(structuredClone(targetDocument), patchDocument, true, false).newDocument;
  const schemaPath = await validateAgainstSiblingSchema(targetPath, result);

  await writeJsonToFile(targetPath, result);

  return {
    targetPath,
    patchPath,
    schemaValidated: Boolean(schemaPath),
  };
}

module.exports = {
  patchJsonFile,
  validateAgainstSiblingSchema,
};