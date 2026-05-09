/**
 * orderBy parsing and sorting per JPQ §4.
 */

import { resolveRelative } from './pointer';
import type { JsonValue } from './types';

export class OrderByError extends Error {
  code = 'BAD_ORDER_BY';
  constructor(message: string) {
    super(message);
  }
}

export interface OrderByKey {
  pointer: string;
  direction: 'ASC' | 'DESC';
}

export function parseOrderBy(orderBy: string | undefined): OrderByKey[] {
  if (!orderBy) return [];
  if (typeof orderBy !== 'string') {
    throw new OrderByError('orderBy must be a string');
  }
  const trimmed = orderBy.trim();
  if (trimmed === '') return [];
  return trimmed.split(',').map((segment) => {
    const parts = segment.trim().split(/\s+/);
    if (parts.length === 0 || parts[0] === '') {
      throw new OrderByError(`Invalid orderBy segment: "${segment}"`);
    }
    const pointer = parts[0];
    let direction: 'ASC' | 'DESC' = 'ASC';
    if (parts.length === 2) {
      const upper = parts[1].toUpperCase();
      if (upper !== 'ASC' && upper !== 'DESC') {
        throw new OrderByError(`Invalid direction in orderBy: "${parts[1]}" (expected ASC or DESC)`);
      }
      direction = upper;
    } else if (parts.length > 2) {
      throw new OrderByError(`Invalid orderBy segment: "${segment}"`);
    }
    return { pointer, direction };
  });
}

function compareValues(a: JsonValue | undefined, b: JsonValue | undefined): number {
  // Missing/null sort policy: missing/null sort last for ASC, first for DESC.
  // Caller flips by direction multiplier.
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // a after b
  if (bMissing) return -1;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) {
    return ta < tb ? -1 : 1;
  }
  if (ta === 'number' || ta === 'string' || ta === 'boolean') {
    return a! < b! ? -1 : a! > b! ? 1 : 0;
  }
  // Fall back to JSON-stringified compare for arrays/objects to keep determinism.
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function sortByKeys<T extends JsonValue>(items: T[], keys: OrderByKey[]): T[] {
  if (keys.length === 0) return items.slice();
  return items.slice().sort((left, right) => {
    for (const key of keys) {
      const lv = resolveRelative(left as JsonValue, key.pointer);
      const rv = resolveRelative(right as JsonValue, key.pointer);
      const baseCompare = compareValues(lv, rv);
      if (baseCompare !== 0) {
        // Apply direction. Note: missing-last semantics is implemented in compareValues
        // (returns +1/-1 regardless of direction), so we should NOT flip those.
        const aMissing = lv === undefined || lv === null;
        const bMissing = rv === undefined || rv === null;
        if (aMissing !== bMissing) {
          // For DESC, missing should sort first => flip the result.
          return key.direction === 'DESC' ? -baseCompare : baseCompare;
        }
        return key.direction === 'DESC' ? -baseCompare : baseCompare;
      }
    }
    return 0;
  });
}
