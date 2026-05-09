/**
 * Provenance: attaches `$array_index` to elements per JPQ §6.
 */

import type { JsonValue } from './types';

const RESERVED_KEYS = new Set(['$array_index', '$primitive_value']);

/**
 * Attach `$array_index` to an element. If the element is a plain object that does not
 * already use a reserved key, the index is added directly. Otherwise the element is
 * wrapped in `{ $array_index, $primitive_value }`.
 */
export function attachArrayIndex(element: JsonValue, index: number): JsonValue {
  if (
    element !== null &&
    typeof element === 'object' &&
    !Array.isArray(element)
  ) {
    const obj = element as Record<string, JsonValue>;
    const hasReserved = Object.keys(obj).some((k) => RESERVED_KEYS.has(k));
    if (!hasReserved) {
      return { $array_index: index, ...obj };
    }
  }
  return { $array_index: index, $primitive_value: element };
}

/**
 * Wrap a value at the document root (used when the source already has `$counts`,
 * `$errors`, or `$primitive_value` at the top level). Per §8.5.
 */
export function wrapRootIfNeeded(
  document: JsonValue,
  metadataKeys: string[],
): JsonValue {
  if (
    document === null ||
    typeof document !== 'object' ||
    Array.isArray(document)
  ) {
    return { $primitive_value: document };
  }
  const obj = document as Record<string, JsonValue>;
  const collides = metadataKeys.some((k) => Object.prototype.hasOwnProperty.call(obj, k));
  if (collides) {
    return { $primitive_value: document };
  }
  return document;
}
