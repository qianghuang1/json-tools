import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import * as assert from 'node:assert/strict';

import { patchJsonFile } from '../src/patch-json';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'json-tools-patch-'));
}

test('patchJsonFile applies a patch and writes the updated document', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'config.json');
  const patchPath = path.join(tempDir, 'patch.json');

  await fs.writeFile(targetPath, JSON.stringify({ version: 1, features: {} }), 'utf8');
  await fs.writeFile(
    patchPath,
    JSON.stringify([
      { op: 'replace', path: '/version', value: 2 },
      { op: 'add', path: '/features/logging', value: true },
    ]),
    'utf8',
  );

  const result = await patchJsonFile({ targetPath, patchPath });
  const updatedDocument = JSON.parse(await fs.readFile(targetPath, 'utf8'));

  assert.equal(result.schemaValidated, false);
  assert.deepEqual(updatedDocument, { version: 2, features: { logging: true } });
});

test('patchJsonFile applies an inline patch', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'config.json');
  await fs.writeFile(targetPath, JSON.stringify({ version: 1, features: {} }), 'utf8');

  const result = await patchJsonFile({
    targetPath,
    patchContent: JSON.stringify([
      { op: 'replace', path: '/version', value: 3 },
      { op: 'add', path: '/features/metrics', value: true },
    ]),
  });
  const updatedDocument = JSON.parse(await fs.readFile(targetPath, 'utf8'));
  assert.equal(result.patchPath, null);
  assert.equal(result.patchSource, 'inline');
  assert.deepEqual(updatedDocument, { version: 3, features: { metrics: true } });
});

test('patchJsonFile validates against sibling schema', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'config.json');
  const patchPath = path.join(tempDir, 'patch.json');
  const schemaPath = path.join(tempDir, 'config.schema.json');

  await fs.writeFile(targetPath, JSON.stringify({ version: 1 }), 'utf8');
  await fs.writeFile(patchPath, JSON.stringify([{ op: 'replace', path: '/version', value: 2 }]), 'utf8');
  await fs.writeFile(
    schemaPath,
    JSON.stringify({
      type: 'object',
      properties: { version: { type: 'number', minimum: 2 } },
      required: ['version'],
      additionalProperties: false,
    }),
    'utf8',
  );

  const result = await patchJsonFile({ targetPath, patchPath });
  assert.equal(result.schemaValidated, true);
});

test('patchJsonFile fails when sibling schema validation fails', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'config.json');
  const patchPath = path.join(tempDir, 'patch.json');
  const schemaPath = path.join(tempDir, 'config.schema.json');

  await fs.writeFile(targetPath, JSON.stringify({ version: 1 }), 'utf8');
  await fs.writeFile(patchPath, JSON.stringify([{ op: 'replace', path: '/version', value: 0 }]), 'utf8');
  await fs.writeFile(
    schemaPath,
    JSON.stringify({
      type: 'object',
      properties: { version: { type: 'number', minimum: 1 } },
      required: ['version'],
      additionalProperties: false,
    }),
    'utf8',
  );

  await assert.rejects(() => patchJsonFile({ targetPath, patchPath }), /Schema validation failed/);
});

test('patchJsonFile rejects when both patch sources are provided', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'config.json');
  const patchPath = path.join(tempDir, 'patch.json');
  await fs.writeFile(targetPath, JSON.stringify({ version: 1 }), 'utf8');
  await fs.writeFile(patchPath, JSON.stringify([{ op: 'replace', path: '/version', value: 2 }]), 'utf8');

  await assert.rejects(
    () =>
      patchJsonFile({
        targetPath,
        patchPath,
        patchContent: JSON.stringify([{ op: 'replace', path: '/version', value: 3 }]),
      }),
    /either patchPath or patchContent, not both/,
  );
});

test('patchJsonFile rejects invalid inline JSON', async () => {
  const tempDir = await createTempDir();
  const targetPath = path.join(tempDir, 'config.json');
  await fs.writeFile(targetPath, JSON.stringify({ version: 1 }), 'utf8');

  await assert.rejects(
    () => patchJsonFile({ targetPath, patchContent: '{not json}' }),
    /Inline patch must be valid JSON/,
  );
});
