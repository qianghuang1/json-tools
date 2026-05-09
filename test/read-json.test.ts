import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import * as assert from 'node:assert/strict';

import { readJsonFile, readJsonFileWithSchema, runJpq } from '../src/read-json';
import { executeJpq, buildResponseDocument } from '../src/core/jpq';
import type { JsonValue } from '../src/core/types';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'json-tools-read-'));
}

test('runJpq with all=true returns the document untouched', () => {
  const document: JsonValue = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const result = runJpq(document, { all: true });
  assert.deepEqual(result, document);
});

test('runJpq applies $array_index and default limit (5) when operations target an array', () => {
  const document: JsonValue = {
    items: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
  };
  const result = runJpq(document, { operations: [{ path: '/items' }] }) as { items: { id: number; $array_index: number }[] };
  assert.equal(result.items.length, 5);
  assert.equal(result.items[0].id, 1);
  assert.equal(result.items[0].$array_index, 0);
  assert.equal(result.items[4].$array_index, 4);
});

test('runJpq applies orderBy DESC and preserves original $array_index', () => {
  const document: JsonValue = {
    items: [
      { id: 'first', priority: 20 },
      { id: 'second', priority: 10 },
      { id: 'third', priority: 30 },
    ],
  };
  const result = runJpq(document, {
    operations: [{ path: '/items', orderBy: '/priority DESC', limit: 3 }],
  }) as { items: Array<{ id: string; priority: number; $array_index: number }> };
  assert.deepEqual(result.items, [
    { $array_index: 2, id: 'third', priority: 30 },
    { $array_index: 0, id: 'first', priority: 20 },
    { $array_index: 1, id: 'second', priority: 10 },
  ]);
});

test('runJpq filters with where clauses (and/or, comparison ops)', () => {
  const document: JsonValue = {
    items: [
      { id: 1, status: 'open', amount: 50 },
      { id: 2, status: 'open', amount: 200 },
      { id: 3, status: 'closed', amount: 500 },
      { id: 4, status: 'open', amount: 150 },
    ],
  };
  const result = runJpq(document, {
    operations: [
      {
        path: '/items',
        where: {
          and: [
            { field: '/status', op: 'eq', value: 'open' },
            { field: '/amount', op: 'gte', value: 100 },
          ],
        },
        orderBy: '/amount ASC',
        limit: 10,
      },
    ],
  }) as { items: Array<{ id: number; $array_index: number }> };
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, 4);
  assert.equal(result.items[0].$array_index, 3);
  assert.equal(result.items[1].id, 2);
});

test('runJpq wraps primitives with $primitive_value', () => {
  const document: JsonValue = { errors: ['x', 'y', 'z'] };
  const result = runJpq(document, {
    operations: [{ path: '/errors', limit: 2 }],
  }) as { errors: Array<{ $array_index: number; $primitive_value: string }> };
  assert.deepEqual(result.errors, [
    { $array_index: 0, $primitive_value: 'x' },
    { $array_index: 1, $primitive_value: 'y' },
  ]);
});

test('runJpq emits PATH_NOT_FOUND in $errors and skips the bad operation', () => {
  const document: JsonValue = { items: [{ id: 1 }] };
  const result = runJpq(document, {
    operations: [{ path: '/missing/path', limit: 1 }],
  }) as { $errors: Record<string, { code: string }> };
  assert.equal(result.$errors['/missing/path'].code, 'PATH_NOT_FOUND');
});

test('runJpq emits PATH_NOT_ARRAY when target is not an array', () => {
  const document: JsonValue = { items: { id: 1 } };
  const result = runJpq(document, {
    operations: [{ path: '/items', limit: 1 }],
  }) as { $errors: Record<string, { code: string }> };
  assert.equal(result.$errors['/items'].code, 'PATH_NOT_ARRAY');
});

test('runJpq nested expand slices child arrays in place', () => {
  const document: JsonValue = {
    orders: [
      {
        id: 1,
        lines: [
          { sku: 'A-3' },
          { sku: 'A-1' },
          { sku: 'A-2' },
        ],
      },
      {
        id: 2,
        lines: [{ sku: 'B-1' }],
      },
    ],
  };
  const result = runJpq(document, {
    operations: [
      {
        path: '/orders',
        limit: 5,
        expand: [{ path: '/lines', limit: 2, orderBy: '/sku ASC' }],
      },
    ],
  }) as { orders: Array<{ id: number; lines: Array<{ sku: string; $array_index: number }> }> };
  assert.equal(result.orders.length, 2);
  assert.equal(result.orders[0].lines.length, 2);
  assert.equal(result.orders[0].lines[0].sku, 'A-1');
  assert.equal(result.orders[0].lines[0].$array_index, 1);
});

test('runJpq count: true returns ungrouped totalAfterFilter', () => {
  const document: JsonValue = {
    items: [
      { id: 1, status: 'open' },
      { id: 2, status: 'closed' },
      { id: 3, status: 'open' },
    ],
  };
  const result = runJpq(document, {
    operations: [
      {
        path: '/items',
        where: { field: '/status', op: 'eq', value: 'open' },
        limit: 0,
        count: true,
      },
    ],
  }) as { $counts: Record<string, { totalAfterFilter: number }> };
  assert.equal(result.$counts['/items'].totalAfterFilter, 2);
});

test('runJpq count with groupBy yields buckets', () => {
  const document: JsonValue = {
    items: [
      { id: 1, status: 'open' },
      { id: 2, status: 'closed' },
      { id: 3, status: 'open' },
      { id: 4, status: 'pending' },
    ],
  };
  const result = runJpq(document, {
    operations: [
      {
        path: '/items',
        limit: 0,
        count: { groupBy: '/status', orderBy: '/count DESC' },
      },
    ],
  }) as {
    $counts: Record<string, { totalAfterFilter: number; groupBy: string; buckets: Array<{ key: string; count: number }> }>;
  };
  const bucket = result.$counts['/items'];
  assert.equal(bucket.totalAfterFilter, 4);
  assert.equal(bucket.buckets[0].count, 2);
  assert.equal(bucket.buckets[0].key, 'open');
});

test('runJpq validation rejects unknown operation properties with friendly message', () => {
  const document: JsonValue = { items: [] };
  assert.throws(
    () => runJpq(document, { operations: [{ path: '/items', bogus: 1 } as never] }),
    /unknown property "bogus"/,
  );
});

test('runJpq validation rejects unknown comparison op', () => {
  const document: JsonValue = { items: [] };
  assert.throws(
    () =>
      runJpq(document, {
        operations: [
          {
            path: '/items',
            where: { field: '/x', op: 'matches' as never, value: 1 },
          },
        ],
      }),
    /Invalid JPQ/,
  );
});

test('readJsonFile reads from disk and applies parameters', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
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

  const result = (await readJsonFile({
    targetPath,
    parameters: [{ path: '/items', orderBy: '/rank DESC', limit: 2 }],
  })) as { items: Array<{ id: number; $array_index: number }> };
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, 2);
  assert.equal(result.items[0].$array_index, 1);
});

test('readJsonFile parameter file with non-array root throws', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const parameterPath = path.join(tempDir, 'opts.json');
  await fs.writeFile(targetPath, JSON.stringify({ items: [] }), 'utf8');
  await fs.writeFile(parameterPath, JSON.stringify({ path: '/items' }), 'utf8');

  await assert.rejects(
    () => readJsonFile({ targetPath, parameterPath }),
    /must contain a JSON array/,
  );
});

test('readJsonFileWithSchema returns schema entry before json entry', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const schemaPath = path.join(tempDir, 'orders.schema.json');
  await fs.writeFile(targetPath, JSON.stringify({ items: [{ id: 1 }] }), 'utf8');
  await fs.writeFile(schemaPath, JSON.stringify({ type: 'object' }), 'utf8');

  const result = await readJsonFileWithSchema({ targetPath });
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'schema');
  assert.equal(result[0].path, schemaPath);
  assert.equal(result[1].type, 'json');
  assert.equal(result[1].path, targetPath);
});

test('readJsonFile with includeAll returns the document untouched', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'orders.json');
  const document = { items: Array.from({ length: 250 }, (_, i) => ({ id: i + 1 })) };
  await fs.writeFile(targetPath, JSON.stringify(document), 'utf8');

  const result = (await readJsonFile({ targetPath, includeAll: true })) as { items: unknown[] };
  assert.equal(result.items.length, 250);
});

test('executeJpq returns structured response with document/counts/errors', () => {
  const document: JsonValue = {
    items: [
      { id: 1, status: 'open' },
      { id: 2, status: 'closed' },
    ],
    bad: 'not-an-array',
  };
  const response = executeJpq(document, {
    operations: [
      { path: '/items', count: true, limit: 1 },
      { path: '/bad', limit: 1 },
    ],
  });
  assert.equal(response.counts['/items'].totalAfterFilter, 2);
  assert.equal(response.errors['/bad'].code, 'PATH_NOT_ARRAY');
  const final = buildResponseDocument(response);
  assert.ok(typeof final === 'object' && final !== null && '$counts' in (final as object));
});
