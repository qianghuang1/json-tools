/**
 * Public package entry. Re-exports the high-level API.
 */

export * from './core/types';
export { executeJpq, buildResponseDocument, type JpqResponse } from './core/jpq';
export { validateJpqRequest, validateJpqOperation, validateJpqOperations, ValidationError } from './core/validate';
export { readJsonFile, readJsonFileWithSchema, runJpq, runJpqStructured, type ReadJsonInput, type ReadJsonEntry } from './read-json';
export { patchJsonFile, type PatchJsonInput, type PatchJsonResult } from './patch-json';
export { buildServer, startServer, type ServerOptions } from './server';
export { hashToken, loadTokenFile, buildAllowedHashSet, type AccessTokenEntry, type TokenFile } from './auth';
