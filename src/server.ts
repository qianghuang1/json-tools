/**
 * HTTP server that hosts JSON files (and their sibling schemas) under a root path.
 *
 * Endpoints (all relative to a JSON file path inside the root):
 *
 *   GET  /api/json/<relative-path>            -> Read with default JPQ (truncates arrays)
 *   GET  /api/json/<relative-path>?all=true   -> Whole document
 *   POST /api/json/<relative-path>            -> Body is a JPQ request; returns response document
 *   GET  /api/schema/<relative-path>          -> Sibling schema content (if present)
 *   GET  /api/list                            -> List of available JSON files (relative paths)
 *
 * The server only reads files; it does not patch or write.
 */

import fastifyCors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runJpq, runJpqStructured } from './read-json';
import { readJsonFromFile, readSiblingSchema } from './io';
import { validateJpqRequest, ValidationError } from './core/validate';
import { requestSchema, operationSchema, whereSchema, countSchema } from './core/schemas';
import type { JpqRequest, JsonValue } from './core/types';
import {
  buildAllowedHashSet,
  extractToken,
  isTokenAllowed,
  loadTokenFile,
  type TokenFile,
} from './auth';

export interface ServerOptions {
  rootDir: string;
  host?: string;
  port?: number;
  logger?: boolean;
  /** Enable CORS for browser clients. Defaults to true. */
  cors?: boolean;
  /** Path to a token file. Mutually exclusive with `tokenFile`. */
  tokenFilePath?: string;
  /** In-memory token file (useful for tests). Mutually exclusive with `tokenFilePath`. */
  tokenFile?: TokenFile;
}

function resolveSafeRelative(rootDir: string, relative: string): string {
  // Normalize and prevent path traversal.
  const decoded = decodeURIComponent(relative);
  const normalized = path.normalize(decoded).replace(/^[/\\]+/, '');
  const absolute = path.resolve(rootDir, normalized);
  const rootResolved = path.resolve(rootDir);
  if (
    absolute !== rootResolved &&
    !absolute.startsWith(rootResolved + path.sep)
  ) {
    throw new Error('Path escapes the root directory');
  }
  return absolute;
}

async function listJsonFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.schema.json')) {
        out.push(path.relative(rootDir, full).split(path.sep).join('/'));
      }
    }
  }
  await walk(rootDir);
  return out.sort();
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const rootDir = path.resolve(options.rootDir);
  const stat = await fs.stat(rootDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Root directory does not exist: ${rootDir}`);
  }

  if (options.tokenFile && options.tokenFilePath) {
    throw new Error('Provide either tokenFile or tokenFilePath, not both.');
  }
  let allowedHashes: Set<string> | null = null;
  if (options.tokenFile) {
    allowedHashes = buildAllowedHashSet(options.tokenFile);
  } else if (options.tokenFilePath) {
    const loaded = await loadTokenFile(options.tokenFilePath);
    allowedHashes = buildAllowedHashSet(loaded);
    if (allowedHashes.size === 0) {
      throw new Error(`Token file ${options.tokenFilePath} has no access tokens; refusing to start.`);
    }
  }

  const app = Fastify({ logger: options.logger ?? true });

  if (options.cors !== false) {
    await app.register(fastifyCors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'x-access-token'],
    });
  }

  // Register JPQ schemas so route schemas can $ref them.
  for (const schema of [requestSchema, operationSchema, whereSchema, countSchema]) {
    app.addSchema(schema);
  }

  // Token authentication: applies to every /api/* route when a token set is configured.
  if (allowedHashes) {
    const requiredHashes = allowedHashes;
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.url.startsWith('/api/')) return;
      const token = extractToken(request.headers as Record<string, string | string[] | undefined>);
      if (!token) {
        reply.header('WWW-Authenticate', 'Bearer realm="json_server"');
        return reply.code(401).send({ error: 'Missing access token' });
      }
      if (!isTokenAllowed(token, requiredHashes)) {
        return reply.code(403).send({ error: 'Invalid access token' });
      }
    });
  }

  app.get('/api/list', async () => {
    return { rootDir, files: await listJsonFiles(rootDir) };
  });

  app.get<{ Params: { '*': string }; Querystring: { all?: string } }>(
    '/api/schema/*',
    async (request, reply) => {
      try {
        const target = resolveSafeRelative(rootDir, request.params['*']);
        const schema = await readSiblingSchema(target);
        if (!schema) {
          return reply.code(404).send({ error: 'Schema not found' });
        }
        return schema.content;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get<{ Params: { '*': string }; Querystring: { all?: string } }>(
    '/api/json/*',
    async (request, reply) => {
      try {
        const target = resolveSafeRelative(rootDir, request.params['*']);
        const document = await readJsonFromFile(target);
        const all = request.query.all === 'true' || request.query.all === '1';
        const result = runJpq(document, all ? { all: true } : { operations: [] });
        return result;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({ error: 'File not found' });
        }
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Params: { '*': string }; Body: JpqRequest }>(
    '/api/json/*',
    async (request, reply) => {
      try {
        const target = resolveSafeRelative(rootDir, request.params['*']);
        const document = await readJsonFromFile(target);
        const validated = validateJpqRequest(request.body);
        const response = runJpqStructured(document, validated);
        const out: JsonValue =
          response.document &&
          typeof response.document === 'object' &&
          !Array.isArray(response.document)
            ? { ...(response.document as Record<string, JsonValue>) }
            : response.document;
        if (Object.keys(response.counts).length > 0 && out && typeof out === 'object' && !Array.isArray(out)) {
          (out as Record<string, JsonValue>).$counts = response.counts as unknown as JsonValue;
        }
        if (Object.keys(response.errors).length > 0 && out && typeof out === 'object' && !Array.isArray(out)) {
          (out as Record<string, JsonValue>).$errors = response.errors as unknown as JsonValue;
        }
        return out;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({ error: 'File not found' });
        }
        if (err instanceof ValidationError) {
          return reply.code(400).send({ error: err.message, details: err.details });
        }
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  return app;
}

export async function startServer(options: ServerOptions): Promise<{ app: FastifyInstance; address: string }> {
  const app = await buildServer(options);
  const address = await app.listen({
    host: options.host ?? '127.0.0.1',
    port: options.port ?? 0,
  });
  return { app, address };
}
