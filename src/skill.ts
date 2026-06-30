import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CopySkillsInput {
  targetDir?: string;
  sourceDir?: string;
  force?: boolean;
}

export interface CopySkillsResult {
  sourceDir: string;
  targetDir: string;
  copiedTo: string;
}

function defaultSkillsSourceDir(): string {
  return path.resolve(__dirname, '..', 'skills');
}

export async function copySkillsFolder(input: CopySkillsInput = {}): Promise<CopySkillsResult> {
  const sourceDir = path.resolve(input.sourceDir ?? defaultSkillsSourceDir());
  const targetDir = path.resolve(input.targetDir ?? process.cwd());
  const copiedTo = path.join(targetDir, 'skills');

  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(sourceDir, copiedTo, {
    recursive: true,
    force: input.force ?? false,
    errorOnExist: !(input.force ?? false),
  });

  return { sourceDir, targetDir, copiedTo };
}
