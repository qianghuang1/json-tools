const {
  DEFAULT_ARRAY_LIMIT,
  getValueAtPath,
  readJsonFromFile,
  setValueAtPath,
  sliceItems,
  sortItems,
  truncateArrays,
} = require('./json-utils');

async function readJsonFile({ targetPath, parameterPath, includeAll = false }) {
  const document = await readJsonFromFile(targetPath);

  if (includeAll) {
    return document;
  }

  let result = truncateArrays(document, DEFAULT_ARRAY_LIMIT);

  if (!parameterPath) {
    return result;
  }

  const options = await readJsonFromFile(parameterPath);
  const targetArray = getValueAtPath(document, options.path);

  if (!Array.isArray(targetArray)) {
    throw new Error(`Path does not point to an array: ${options.path}`);
  }

  const sortedItems = sortItems(targetArray, options.orderBy);
  const limitedItems = sliceItems(sortedItems, options.offset, options.limit);

  result = setValueAtPath(result, options.path, limitedItems);
  return result;
}

module.exports = {
  readJsonFile,
};