const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { readJsonFile } = require('../src/read-json');

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

  assert.equal(result.items.length, 200);
  assert.equal(result.items[0].id, 1);
  assert.equal(result.items.at(-1).id, 200);
});

test('readJsonFile applies path, sorting, offset, and limit from a parameter file', async () => {
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
    }),
    'utf8',
  );
  await fs.writeFile(
    parameterPath,
    JSON.stringify({ path: 'items', orderBy: 'datetime', offset: 1, limit: 1 }),
    'utf8',
  );

  const result = await readJsonFile({ targetPath, parameterPath });

  assert.deepEqual(result.items, [{ id: 2, datetime: '2026-04-18T10:00:00Z' }]);
});

test('readJsonFile fails when the selected path is not an array', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const parameterPath = path.join(tempDir, 'read-options.json');

  await fs.writeFile(targetPath, JSON.stringify({ items: { id: 1 } }), 'utf8');
  await fs.writeFile(parameterPath, JSON.stringify({ path: 'items', limit: 1 }), 'utf8');

  await assert.rejects(
    () => readJsonFile({ targetPath, parameterPath }),
    /Path does not point to an array/,
  );
});