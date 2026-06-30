import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface StorageDirectoryEntry {
  name: string;
  description: string;
  path: string;
}

export interface BuildStorageDirectoryInput {
  targetDir?: string;
}

export interface BuildStorageDirectoryResult {
  targetDir: string;
  directoryPath: string;
  entries: StorageDirectoryEntry[];
}

function expandHome(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function defaultStorageDir(): string {
  return path.join(os.homedir(), '.agent-storage');
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function encodeMarkdownLinkPath(filePath: string): string {
  return toPosixPath(filePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function readSchemaMetadata(schemaPath: string): Promise<{ title?: string; description?: string }> {
  try {
    const content = await fs.readFile(schemaPath, 'utf8');
    const parsed = JSON.parse(content) as { title?: unknown; description?: unknown };
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
    };
  } catch {
    return {};
  }
}

async function collectJsonFiles(rootDir: string, currentDir: string, entries: StorageDirectoryEntry[]): Promise<void> {
  const children = await fs.readdir(currentDir, { withFileTypes: true });
  for (const child of children) {
    if (child.name === '.tmp') continue;
    const childPath = path.join(currentDir, child.name);
    if (child.isDirectory()) {
      await collectJsonFiles(rootDir, childPath, entries);
      continue;
    }
    if (!child.isFile() || !child.name.endsWith('.json') || child.name.endsWith('.schema.json')) {
      continue;
    }

    const parsed = path.parse(childPath);
    const schemaPath = path.join(parsed.dir, `${parsed.name}.schema.json`);
    const schema = await readSchemaMetadata(schemaPath);
    const relativePath = toPosixPath(path.relative(rootDir, childPath));
    entries.push({
      name: schema.title ?? parsed.name,
      description: schema.description ?? '',
      path: relativePath,
    });
  }
}

function renderDirectory(entries: StorageDirectoryEntry[]): string {
  const lines = [
    '# Storage Directory',
    '',
    '| Storage | Description | Path |',
    '| --- | --- | --- |',
  ];

  for (const entry of entries) {
    const link = encodeMarkdownLinkPath(entry.path);
    lines.push(
      `| [${escapeTableCell(entry.name)}](${link}) | ${escapeTableCell(entry.description)} | \`${escapeTableCell(entry.path)}\` |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export async function buildStorageDirectory(input: BuildStorageDirectoryInput = {}): Promise<BuildStorageDirectoryResult> {
  const targetDir = path.resolve(expandHome(input.targetDir ?? defaultStorageDir()));
  await fs.mkdir(targetDir, { recursive: true });

  const entries: StorageDirectoryEntry[] = [];
  await collectJsonFiles(targetDir, targetDir, entries);
  entries.sort((left, right) => left.path.localeCompare(right.path));

  const directoryPath = path.join(targetDir, 'directory.md');
  await fs.writeFile(directoryPath, renderDirectory(entries), 'utf8');

  return { targetDir, directoryPath, entries };
}
