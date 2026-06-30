import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import * as assert from 'node:assert/strict';

import { buildStorageDirectory } from '../src/storage';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'json-tools-storage-'));
}

test('buildStorageDirectory generates a table from JSON files and sibling schema metadata', async () => {
  const tempDir = await createTempDir();
  const personalDir = path.join(tempDir, 'personal');
  await fs.mkdir(personalDir, { recursive: true });
  await fs.writeFile(path.join(personalDir, 'feeding-log.json'), JSON.stringify({ entries: [] }), 'utf8');
  await fs.writeFile(
    path.join(personalDir, 'feeding-log.schema.json'),
    JSON.stringify({ title: 'Feeding Log', description: 'Baby feeding records' }),
    'utf8',
  );
  await fs.writeFile(path.join(tempDir, 'projects.json'), JSON.stringify({ items: [] }), 'utf8');

  const result = await buildStorageDirectory({ targetDir: tempDir });
  const directory = await fs.readFile(path.join(tempDir, 'directory.md'), 'utf8');

  assert.equal(result.entries.length, 2);
  assert.equal(result.directoryPath, path.join(tempDir, 'directory.md'));
  assert.match(directory, /\| Storage \| Description \| Path \|/);
  assert.match(directory, /\| \[Feeding Log\]\(personal\/feeding-log\.json\) \| Baby feeding records \| `personal\/feeding-log\.json` \|/);
  assert.match(directory, /\| \[projects\]\(projects\.json\) \|  \| `projects\.json` \|/);
  assert.doesNotMatch(directory, /schema\.json/);
});
