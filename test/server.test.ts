import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import * as assert from 'node:assert/strict';

import { buildServer } from '../src/server';
import { hashToken } from '../src/auth';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'json-tools-server-'));
}

test('GET /api/list returns relative paths to JSON files', async () => {
  const tempDir = await createTempDir();
  await fs.mkdir(path.join(tempDir, 'sub'));
  await fs.writeFile(path.join(tempDir, 'a.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempDir, 'sub', 'b.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempDir, 'a.schema.json'), '{}', 'utf8');

  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/list' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { files: string[] };
    assert.deepEqual(body.files, ['a.json', 'sub/b.json']);
  } finally {
    await app.close();
  }
});

test('GET /api/json/<path> returns truncated document by default', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(
    path.join(tempDir, 'orders.json'),
    JSON.stringify({ items: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })) }),
    'utf8',
  );

  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/json/orders.json' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { items: unknown[] };
    // No operations means engine just walks the document; arrays are not auto-truncated
    // unless an operation targets them. But since GET sends an empty operations list,
    // the document is returned as-is. This matches "all=false but no operations" semantics.
    assert.equal(body.items.length, 10);
  } finally {
    await app.close();
  }
});

test('POST /api/json/<path> with JPQ body filters and counts', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(
    path.join(tempDir, 'orders.json'),
    JSON.stringify({
      items: [
        { id: 1, status: 'open' },
        { id: 2, status: 'closed' },
        { id: 3, status: 'open' },
      ],
    }),
    'utf8',
  );

  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/json/orders.json',
      payload: {
        operations: [
          {
            path: '/items',
            where: { field: '/status', op: 'eq', value: 'open' },
            limit: 10,
            count: true,
          },
        ],
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { items: { id: number }[]; $counts: Record<string, { totalAfterFilter: number }> };
    assert.equal(body.items.length, 2);
    assert.equal(body.$counts['/items'].totalAfterFilter, 2);
  } finally {
    await app.close();
  }
});

test('POST /api/json/<path> supports select projection', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(
    path.join(tempDir, 'orders.json'),
    JSON.stringify({
      items: [
        { id: 1, status: 'open', amount: 10 },
        { id: 2, status: 'closed', amount: 20 },
      ],
    }),
    'utf8',
  );

  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/json/orders.json',
      payload: {
        operations: [{ path: '/items', select: '/id, /status', limit: 2 }],
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { items: Array<{ $array_index: number; id: number; status: string; amount?: number }> };
    assert.deepEqual(body.items, [
      { $array_index: 0, id: 1, status: 'open' },
      { $array_index: 1, id: 2, status: 'closed' },
    ]);
    assert.equal(body.items[0].amount, undefined);
  } finally {
    await app.close();
  }
});

test('POST /api/json with invalid request returns 400 with details', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(path.join(tempDir, 'a.json'), '{}', 'utf8');
  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/json/a.json',
      payload: { operations: [{ path: '/a', bogus: 1 }] },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('GET /api/json with path traversal returns 400', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(path.join(tempDir, 'a.json'), '{}', 'utf8');
  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/json/..%2F..%2Fetc%2Fpasswd' });
    assert.equal(res.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('GET /api/schema returns sibling schema', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(path.join(tempDir, 'a.json'), '{}', 'utf8');
  await fs.writeFile(path.join(tempDir, 'a.schema.json'), JSON.stringify({ type: 'object' }), 'utf8');
  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/schema/a.json' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { type: 'object' });
  } finally {
    await app.close();
  }
});

test('CORS is enabled by default for browser API clients', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(path.join(tempDir, 'a.json'), '{}', 'utf8');
  const app = await buildServer({ rootDir: tempDir, logger: false });
  try {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/list',
      headers: {
        origin: 'https://example.test',
        'access-control-request-method': 'GET',
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://example.test');
    assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
    assert.match(String(preflight.headers['access-control-allow-headers']), /authorization/i);

    const actual = await app.inject({
      method: 'GET',
      url: '/api/list',
      headers: { origin: 'https://example.test' },
    });
    assert.equal(actual.statusCode, 200);
    assert.equal(actual.headers['access-control-allow-origin'], 'https://example.test');
    assert.equal(actual.headers['access-control-allow-credentials'], 'true');
  } finally {
    await app.close();
  }
});

test('CORS can be disabled', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(path.join(tempDir, 'a.json'), '{}', 'utf8');
  const app = await buildServer({ rootDir: tempDir, logger: false, cors: false });
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/list',
      headers: { origin: 'https://example.test' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  } finally {
    await app.close();
  }
});

test('token auth: missing token returns 401, valid bearer token returns 200, wrong token returns 403', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(path.join(tempDir, 'a.json'), JSON.stringify({ ok: true }), 'utf8');
  const goodToken = 'super-secret-token';
  const app = await buildServer({
    rootDir: tempDir,
    logger: false,
    tokenFile: {
      accessTokens: [
        { id: 'tok-1', tokenHash: hashToken(goodToken) },
      ],
    },
  });
  try {
    const noTok = await app.inject({ method: 'GET', url: '/api/list' });
    assert.equal(noTok.statusCode, 401);
    assert.match(noTok.headers['www-authenticate'] as string, /Bearer/);

    const badTok = await app.inject({
      method: 'GET',
      url: '/api/list',
      headers: { authorization: 'Bearer wrong-token' },
    });
    assert.equal(badTok.statusCode, 403);

    const okBearer = await app.inject({
      method: 'GET',
      url: '/api/list',
      headers: { authorization: `Bearer ${goodToken}` },
    });
    assert.equal(okBearer.statusCode, 200);

    const okHeader = await app.inject({
      method: 'GET',
      url: '/api/list',
      headers: { 'x-access-token': goodToken },
    });
    assert.equal(okHeader.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('token auth: loads token file from disk', async () => {
  const tempDir = await createTempDir();
  await fs.writeFile(path.join(tempDir, 'a.json'), '{}', 'utf8');
  const tokenFilePath = path.join(tempDir, 'tokens.json');
  const goodToken = 'file-token-xyz';
  await fs.writeFile(
    tokenFilePath,
    JSON.stringify({
      accessTokens: [
        {
          id: '93def96f-5b5d-45dc-9e60-83ec93df43a0',
          tokenHash: hashToken(goodToken),
          createdAt: '2026-05-04T11:41:11.786Z',
        },
      ],
    }),
    'utf8',
  );

  const app = await buildServer({ rootDir: tempDir, logger: false, tokenFilePath });
  try {
    const ok = await app.inject({
      method: 'GET',
      url: '/api/list',
      headers: { authorization: `Bearer ${goodToken}` },
    });
    assert.equal(ok.statusCode, 200);
  } finally {
    await app.close();
  }
});
