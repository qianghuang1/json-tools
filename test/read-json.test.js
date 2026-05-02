const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { readJsonFile, readJsonFileWithSchema } = require('../src/read-json');

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'json-tools-read-'));
}

test('readJsonFile returns the whole document when all is enabled', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');

  const document = { items: Array.from({ length: 250 }, (_, index) => ({ id: index + 1 })) };
  await fs.writeFile(targetPath, JSON.stringify(document), 'utf8');

  const result = await readJsonFile({ targetPath, includeAll: true });

  assert.equal(result.items.length, 250);
});

test('readJsonFile truncates arrays to the default limit', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');

  const document = { items: Array.from({ length: 250 }, (_, index) => ({ id: index + 1 })) };
  await fs.writeFile(targetPath, JSON.stringify(document), 'utf8');

  const result = await readJsonFile({ targetPath });

  assert.equal(result.items.length, 5);
  assert.equal(result.items[0].id, 1);
  assert.equal(result.items[0].$array_index, 0);
  assert.equal(result.items.at(-1).id, 5);
  assert.equal(result.items.at(-1).$array_index, 4);
});

test('readJsonFile applies multiple path, sorting, offset, and limit options from a parameter file', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const parameterPath = path.join(tempDir, 'read-options.json');

  await fs.writeFile(
    targetPath,
    JSON.stringify({
      items: [
        { id: 3, datetime: '2026-04-18T11:00:00Z' },
        { id: 1, datetime: '2026-04-18T09:00:00Z' },
        { id: 2, datetime: '2026-04-18T10:00:00Z' },
      ],
      errors: [
        { id: 'c', ts: 3 },
        { id: 'a', ts: 1 },
        { id: 'b', ts: 2 },
      ],
    }),
    'utf8',
  );
  await fs.writeFile(
    parameterPath,
    JSON.stringify([
      { path: 'items', orderBy: 'datetime', offset: 1, limit: 1 },
      { path: 'errors', orderBy: 'ts', offset: 0, limit: 2 },
    ]),
    'utf8',
  );

  const result = await readJsonFile({ targetPath, parameterPath });

  assert.deepEqual(result.items, [{ id: 2, datetime: '2026-04-18T10:00:00Z', $array_index: 2 }]);
  assert.deepEqual(result.errors, [
    { id: 'a', ts: 1, $array_index: 1 },
    { id: 'b', ts: 2, $array_index: 2 },
  ]);
});

test('readJsonFile preserves original array indexes after ordering', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const parameterPath = path.join(tempDir, 'read-options.json');

  await fs.writeFile(
    targetPath,
    JSON.stringify({
      items: [
        { id: 'first', priority: 20 },
        { id: 'second', priority: 10 },
        { id: 'third', priority: 30 },
      ],
    }),
    'utf8',
  );
  await fs.writeFile(
    parameterPath,
    JSON.stringify([{ path: 'items', orderBy: 'priority DESC', limit: 3 }]),
    'utf8',
  );

  const result = await readJsonFile({ targetPath, parameterPath });

  assert.deepEqual(result.items, [
    { id: 'third', priority: 30, $array_index: 2 },
    { id: 'first', priority: 20, $array_index: 0 },
    { id: 'second', priority: 10, $array_index: 1 },
  ]);
});

test('readJsonFile fails when the selected path is not an array', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const parameterPath = path.join(tempDir, 'read-options.json');

  await fs.writeFile(targetPath, JSON.stringify({ items: { id: 1 } }), 'utf8');
  await fs.writeFile(parameterPath, JSON.stringify([{ path: 'items', limit: 1 }]), 'utf8');

  await assert.rejects(
    () => readJsonFile({ targetPath, parameterPath }),
    /Path does not point to an array/,
  );
});

test('readJsonFileWithSchema reads a sibling schema before JSON content and merges inline and file parameters', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const schemaPath = path.join(tempDir, 'orders.schema.json');
  const parameterPath = path.join(tempDir, 'read-options.json');

  await fs.writeFile(
    targetPath,
    JSON.stringify({
      items: [
        { id: 1, rank: 2 },
        { id: 2, rank: 3 },
        { id: 3, rank: 1 },
      ],
    }),
    'utf8',
  );
  await fs.writeFile(
    schemaPath,
    JSON.stringify({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object' },
        },
      },
    }),
    'utf8',
  );
  await fs.writeFile(parameterPath, JSON.stringify([{ path: 'items', orderBy: 'rank DESC', limit: 2 }]), 'utf8');

  const result = await readJsonFileWithSchema({
    targetPath,
    parameters: [{ path: 'items', offset: 1 }],
    parameterPaths: [parameterPath],
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].path, schemaPath);
  assert.equal(result[0].type, 'schema');
  assert.equal(result[1].path, targetPath);
  assert.equal(result[1].type, 'json');
  assert.deepEqual(result[1].content.items, [
    { id: 2, rank: 3, $array_index: 1 },
    { id: 1, rank: 2, $array_index: 0 },
  ]);
});