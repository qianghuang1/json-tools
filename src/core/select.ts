/**
 * select parsing and element projection for JPQ.
 */

import { parsePointer, resolveRelative } from './pointer';
import type { JsonValue } from './types';

export class SelectError extends Error {
  code = 'BAD_SELECT';
  constructor(message: string) {
    super(message);
  }
}

function setProjectedAtPointer(target: Record<string, JsonValue>, pointer: string, value: JsonValue): void {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return;
  }

  let current: Record<string, JsonValue> = target;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    const existing = current[token];
    if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
      current = existing as Record<string, JsonValue>;
      continue;
    }
    const next: Record<string, JsonValue> = {};
    current[token] = next;
    current = next;
  }

  const leaf = tokens[tokens.length - 1];
  current[leaf] = value;
}

/**
 * Parse a comma-separated select expression into relative pointers.
 */
export function parseSelect(select: string | undefined): string[] {
  if (!select) return [];
  if (typeof select !== 'string') {
    throw new SelectError('select must be a string');
  }
  const trimmed = select.trim();
  if (trimmed === '') {
    throw new SelectError('select cannot be empty');
  }

  return trimmed.split(',').map((segment) => {
    const pointer = segment.trim();
    if (!pointer) {
      throw new SelectError('select contains an empty pointer segment');
    }
    // Validate pointer syntax consistency with other pointer-accepting features.
    parsePointer(pointer);
    return pointer;
  });
}

/**
 * Project decorated array elements to selected fields. `$array_index` is always retained
 * for plain-object elements. Wrapped primitive/object-collision elements are returned as-is.
 */
export function applySelect(items: JsonValue[], pointers: string[]): JsonValue[] {
  if (pointers.length === 0) {
    return items;
  }

  return items.map((element) => {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) {
      return element;
    }

    const objectElement = element as Record<string, JsonValue>;
    if (Object.prototype.hasOwnProperty.call(objectElement, '$primitive_value')) {
      return element;
    }

    const projected: Record<string, JsonValue> = { $array_index: objectElement.$array_index };
    for (const pointer of pointers) {
      const value = resolveRelative(objectElement, pointer);
      if (value === undefined) continue;
      setProjectedAtPointer(projected, pointer, value);
    }
    return projected;
  });
}
