const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_ARRAY_LIMIT = 5;

async function readJsonFromFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJsonToFile(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, serialized, 'utf8');
}

function getSchemaPath(targetPath) {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `${parsed.name}.schema.json`);
}

function getValueAtPath(root, inputPath) {
  if (!inputPath) {
    return root;
  }

  return inputPath.split('.').reduce((currentValue, segment) => {
    if (currentValue === null || currentValue === undefined) {
      return undefined;
    }

    return currentValue[segment];
  }, root);
}

function setValueAtPath(root, inputPath, newValue) {
  if (!inputPath) {
    return newValue;
  }

  const clonedRoot = structuredClone(root);
  const segments = inputPath.split('.');
  let currentValue = clonedRoot;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];

    if (currentValue[segment] === undefined) {
      throw new Error(`Path not found: ${inputPath}`);
    }

    currentValue = currentValue[segment];
  }

  currentValue[segments.at(-1)] = newValue;
  return clonedRoot;
}

function parseOrderBy(orderBy) {
  if (!orderBy) {
    return null;
  }

  const match = String(orderBy).trim().match(/^(.*?)(?:\s+(ASC|DESC))?$/i);

  if (!match) {
    return null;
  }

  return {
    field: match[1].trim(),
    direction: (match[2] || 'ASC').toUpperCase(),
  };
}

function sortItems(items, orderBy) {
  const parsedOrderBy = parseOrderBy(orderBy);

  if (!parsedOrderBy || !parsedOrderBy.field) {
    return [...items];
  }

  const directionMultiplier = parsedOrderBy.direction === 'DESC' ? -1 : 1;

  return [...items].sort((left, right) => {
    const leftValue = left?.[parsedOrderBy.field];
    const rightValue = right?.[parsedOrderBy.field];

    if (leftValue === rightValue) {
      return 0;
    }

    if (leftValue === undefined) {
      return 1;
    }

    if (rightValue === undefined) {
      return -1;
    }

    return (leftValue < rightValue ? -1 : 1) * directionMultiplier;
  });
}

function sliceItems(items, offset = 0, limit = DEFAULT_ARRAY_LIMIT) {
  const normalizedOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;

  if (limit < 0) {
    return items.slice(normalizedOffset);
  }

  const normalizedLimit = Number.isFinite(limit) ? limit : DEFAULT_ARRAY_LIMIT;
  return items.slice(normalizedOffset, normalizedOffset + normalizedLimit);
}

function addArrayIndex(item, arrayIndex, maxItems = DEFAULT_ARRAY_LIMIT) {
  const normalizedItem = truncateArrays(item, maxItems);

  if (normalizedItem && typeof normalizedItem === 'object' && !Array.isArray(normalizedItem)) {
    return {
      ...normalizedItem,
      $array_index: arrayIndex,
    };
  }

  return normalizedItem;
}

function decorateArrayItems(items) {
  return items.map((item, index) => addArrayIndex(item, index));
}

function truncateArrays(value, maxItems = DEFAULT_ARRAY_LIMIT) {
  if (Array.isArray(value)) {
    return value.slice(0, maxItems).map((item, index) => addArrayIndex(item, index, maxItems));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, truncateArrays(nestedValue, maxItems)]),
    );
  }

  return value;
}

module.exports = {
  DEFAULT_ARRAY_LIMIT,
  getSchemaPath,
  getValueAtPath,
  decorateArrayItems,
  parseOrderBy,
  readJsonFromFile,
  setValueAtPath,
  sliceItems,
  sortItems,
  truncateArrays,
  writeJsonToFile,
};