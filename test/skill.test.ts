import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import * as assert from 'node:assert/strict';

import { copySkillsFolder } from '../src/skill';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'json-tools-skill-'));
}

test('copySkillsFolder copies a source skills folder into target skills', async () => {
  const tempDir = await createTempDir();
  const sourceDir = path.join(tempDir, 'source-skills');
  const targetDir = path.join(tempDir, 'target');
  await fs.mkdir(path.join(sourceDir, 'storage'), { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'storage', 'SKILL.md'), '# Storage\n', 'utf8');

  const result = await copySkillsFolder({ sourceDir, targetDir });
  const copied = await fs.readFile(path.join(targetDir, 'skills', 'storage', 'SKILL.md'), 'utf8');

  assert.equal(result.copiedTo, path.join(targetDir, 'skills'));
  assert.equal(copied, '# Storage\n');
});
