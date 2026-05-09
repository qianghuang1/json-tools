/**
 * RFC 6901 JSON Pointer parsing and resolution.
 */

import type { JsonValue } from './types';

export class PointerError extends Error {
  code: 'BAD_POINTER' | 'PATH_NOT_FOUND';
  constructor(code: 'BAD_POINTER' | 'PATH_NOT_FOUND', message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Parse a JSON Pointer into reference tokens.
 *
 * @param pointer Either an absolute pointer ("/a/b") or a relative one (no leading slash).
 *                An empty string returns no tokens (refers to the current value).
 */
export function parsePointer(pointer: string): string[] {
  if (typeof pointer !== 'string') {
    throw new PointerError('BAD_POINTER', `Pointer must be a string, got ${typeof pointer}`);
  }
  if (pointer === '') {
    return [];
  }
  // Allow leading "/" optional (relative pointers per protocol §2)
  const body = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  return body.split('/').map((token) => {
    // ~1 first, then ~0 per RFC 6901
    return token.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function joinPointer(...parts: string[]): string {
  return parts
    .filter((p) => p && p !== '')
    .map((p) => (p.startsWith('/') ? p : `/${p}`))
    .join('');
}

/**
 * Resolve a pointer against a value. Returns `undefined` when any token is missing.
 * The special token `$primitive_value` refers to the value itself when nothing else matches.
 */
export function resolvePointer(root: JsonValue | undefined, pointer: string): JsonValue | undefined {
  const tokens = parsePointer(pointer);
  let current: JsonValue | undefined = root;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        return undefined;
      }
      const index = Number(token);
      current = index < current.length ? current[index] : undefined;
    } else if (typeof current === 'object') {
      current = (current as Record<string, JsonValue>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Resolve a pointer that may use `$primitive_value` or `""` to refer to the element value
 * itself (used inside where/orderBy when iterating over wrapped primitives).
 */
export function resolveRelative(element: JsonValue | undefined, pointer: string): JsonValue | undefined {
  if (pointer === '' || pointer === '$primitive_value' || pointer === '/$primitive_value') {
    if (
      element !== null &&
      typeof element === 'object' &&
      !Array.isArray(element) &&
      Object.prototype.hasOwnProperty.call(element, '$primitive_value')
    ) {
      return (element as Record<string, JsonValue>).$primitive_value;
    }
    return element;
  }
  return resolvePointer(element, pointer);
}

/**
 * Set a value at a pointer in a deep-cloned copy of `root`. Returns the updated copy.
 * Throws PointerError(PATH_NOT_FOUND) if any intermediate token does not resolve.
 */
export function setAtPointer(root: JsonValue, pointer: string, value: JsonValue): JsonValue {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return value;
  }
  const cloned = structuredClone(root);
  let current: JsonValue = cloned;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (current === null || typeof current !== 'object') {
      throw new PointerError('PATH_NOT_FOUND', `Pointer not found: ${pointer}`);
    }
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new PointerError('PATH_NOT_FOUND', `Pointer not found: ${pointer}`);
      }
      current = current[index];
    } else {
      const obj = current as Record<string, JsonValue>;
      if (!Object.prototype.hasOwnProperty.call(obj, token)) {
        throw new PointerError('PATH_NOT_FOUND', `Pointer not found: ${pointer}`);
      }
      current = obj[token];
    }
  }
  const lastToken = tokens[tokens.length - 1];
  if (Array.isArray(current)) {
    const index = Number(lastToken);
    if (!Number.isInteger(index) || index < 0 || index > current.length) {
      throw new PointerError('PATH_NOT_FOUND', `Pointer not found: ${pointer}`);
    }
    current[index] = value;
  } else if (current !== null && typeof current === 'object') {
    (current as Record<string, JsonValue>)[lastToken] = value;
  } else {
    throw new PointerError('PATH_NOT_FOUND', `Pointer not found: ${pointer}`);
  }
  return cloned;
}
