/**
 * Token-based authentication for the HTTP server.
 *
 * A token file has shape:
 *   { "accessTokens": [ { "id": "...", "tokenHash": "<sha256-hex>", "createdAt": "..." }, ... ] }
 *
 * Clients send the raw token via the `Authorization: Bearer <token>` header (or
 * `x-access-token: <token>`). The server hashes the presented token with SHA-256
 * and checks the hex digest against the configured set.
 */

import * as crypto from 'node:crypto';
import { readJsonFromFile } from './io';
import type { JsonValue } from './core/types';

export interface AccessTokenEntry {
  id: string;
  tokenHash: string;
  createdAt?: string;
}

export interface TokenFile {
  accessTokens: AccessTokenEntry[];
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function loadTokenFile(filePath: string): Promise<TokenFile> {
  const content = (await readJsonFromFile(filePath)) as unknown as JsonValue;
  if (
    !content ||
    typeof content !== 'object' ||
    Array.isArray(content) ||
    !Array.isArray((content as { accessTokens?: unknown }).accessTokens)
  ) {
    throw new Error(`Token file ${filePath} must contain an "accessTokens" array.`);
  }
  const entries = (content as { accessTokens: unknown[] }).accessTokens;
  const accessTokens: AccessTokenEntry[] = entries.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as { tokenHash?: unknown }).tokenHash !== 'string' ||
      typeof (entry as { id?: unknown }).id !== 'string'
    ) {
      throw new Error(`Token file ${filePath}: accessTokens[${index}] must have string "id" and "tokenHash".`);
    }
    const e = entry as { id: string; tokenHash: string; createdAt?: unknown };
    return {
      id: e.id,
      tokenHash: e.tokenHash.toLowerCase(),
      createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
    };
  });
  return { accessTokens };
}

/**
 * Build a Set of allowed sha256 hex digests for fast O(1) lookup.
 */
export function buildAllowedHashSet(tokenFile: TokenFile): Set<string> {
  return new Set(tokenFile.accessTokens.map((t) => t.tokenHash.toLowerCase()));
}

/**
 * Extract a bearer token from a request's Authorization or x-access-token header.
 * Returns `null` if neither header is present.
 */
export function extractToken(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const direct = headers['x-access-token'];
  if (typeof direct === 'string' && direct.trim() !== '') {
    return direct.trim();
  }
  return null;
}

/**
 * Constant-time check that the presented token's hash is in the allowed set.
 * Uses `timingSafeEqual` per candidate to mitigate hash-comparison timing leaks.
 */
export function isTokenAllowed(token: string, allowed: Set<string>): boolean {
  const presented = hashToken(token);
  const presentedBuf = Buffer.from(presented, 'hex');
  for (const candidate of allowed) {
    const candidateBuf = Buffer.from(candidate, 'hex');
    if (
      candidateBuf.length === presentedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, presentedBuf)
    ) {
      return true;
    }
  }
  return false;
}
