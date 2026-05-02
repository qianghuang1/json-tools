const {
  DEFAULT_ARRAY_LIMIT,
  getSchemaPath,
  getValueAtPath,
  decorateArrayItems,
  readJsonFromFile,
  setValueAtPath,
  sliceItems,
  sortItems,
  truncateArrays,
} = require('./json-utils');
const fs = require('node:fs/promises');

async function readParameters(parameterPaths = [], inlineParameters = []) {
  const fileParameters = [];

  for (const parameterPath of parameterPaths) {
    const optionsList = await readJsonFromFile(parameterPath);

    if (!Array.isArray(optionsList)) {
      throw new Error(`Read options file must contain a JSON array: ${parameterPath}`);
    }

    fileParameters.push(...optionsList);
  }

  return [...inlineParameters, ...fileParameters];
}

async function readSiblingSchema(targetPath) {
  const schemaPath = getSchemaPath(targetPath);

  try {
    await fs.access(schemaPath);
  } catch {
    return null;
  }

  return {
    path: schemaPath,
    type: 'schema',
    content: await readJsonFromFile(schemaPath),
  };
}

function applyReadParameters(document, parameters = []) {
  let result = truncateArrays(document, DEFAULT_ARRAY_LIMIT);

  if (parameters.length === 0) {
    return result;
  }

  for (const options of parameters) {
    const targetArray = getValueAtPath(document, options.path);

    if (!Array.isArray(targetArray)) {
      throw new Error(`Path does not point to an array: ${options.path}`);
    }

    const sortedItems = sortItems(decorateArrayItems(targetArray), options.orderBy);
    const limitedItems = sliceItems(sortedItems, options.offset, options.limit);

    result = setValueAtPath(result, options.path, limitedItems);
  }

  return result;
}

async function readJsonFile({ targetPath, parameterPath, parameters = [], parameterPaths = [], includeAll = false }) {
  const document = await readJsonFromFile(targetPath);

  if (includeAll) {
    return document;
  }

  const mergedParameterPaths = [...parameterPaths, ...(parameterPath ? [parameterPath] : [])];
  const mergedParameters = await readParameters(mergedParameterPaths, parameters);

  return applyReadParameters(document, mergedParameters);
}

async function readJsonFileWithSchema({ targetPath, parameterPath, parameters = [], parameterPaths = [], includeAll = false }) {
  const schemaEntry = await readSiblingSchema(targetPath);
  const document = await readJsonFile({
    targetPath,
    parameterPath,
    parameters,
    parameterPaths,
    includeAll,
  });

  const results = [];

  if (schemaEntry) {
    results.push(schemaEntry);
  }

  results.push({
    path: targetPath,
    type: 'json',
    content: document,
  });

  return results;
}

module.exports = {
  readJsonFile,
  readJsonFileWithSchema,
};