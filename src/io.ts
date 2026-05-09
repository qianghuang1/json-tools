/**
 * File-system I/O helpers for JSON tools. These intentionally do not perform any
 * JPQ logic — they only handle reading/writing JSON and locating sibling schemas.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { JsonValue } from './core/types';

export async function readJsonFromFile(filePath: string): Promise<JsonValue> {
  const content = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(content) as JsonValue;
  } catch (err) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${(err as Error).message}`);
  }
}

export async function writeJsonToFile(filePath: string, value: JsonValue): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, serialized, 'utf8');
}

export function getSchemaPath(targetPath: string): string {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `${parsed.name}.schema.json`);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readSiblingSchema(targetPath: string): Promise<{ path: string; content: JsonValue } | null> {
  const schemaPath = getSchemaPath(targetPath);
  if (!(await fileExists(schemaPath))) return null;
  return { path: schemaPath, content: await readJsonFromFile(schemaPath) };
}
