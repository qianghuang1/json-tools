/**
 * Count aggregation per JPQ §7.
 */

import { resolveRelative } from './pointer';
import { parseOrderBy, sortByKeys } from './sort';
import type { CountOptions, CountResult, CountBucket, JsonValue } from './types';

export class GroupByError extends Error {
  code = 'BAD_GROUP_BY';
  constructor(message: string) {
    super(message);
  }
}

function parseGroupBy(groupBy: string): string[] {
  return groupBy
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function canonicalKey(value: JsonValue): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, JsonValue> = {};
      for (const key of Object.keys(v as Record<string, JsonValue>).sort()) {
        sorted[key] = (v as Record<string, JsonValue>)[key];
      }
      return sorted;
    }
    return v;
  });
}

export function computeCount(
  filtered: JsonValue[],
  count: boolean | CountOptions | undefined,
): CountResult | null {
  if (count === undefined || count === false) return null;

  const opts: CountOptions = count === true ? {} : count;
  const totalAfterFilter = filtered.length;

  if (!opts.groupBy || opts.groupBy.trim() === '') {
    return { totalAfterFilter };
  }

  const pointers = parseGroupBy(opts.groupBy);
  if (pointers.length === 0) {
    throw new GroupByError(`Invalid groupBy: "${opts.groupBy}"`);
  }

  const nullKey = opts.nullKey === undefined ? null : opts.nullKey;

  const map = new Map<string, { key: JsonValue; count: number }>();
  for (const item of filtered) {
    const keyValues = pointers.map((p) => {
      const v = resolveRelative(item, p);
      return v === undefined || v === null ? nullKey : v;
    });
    let keyValue: JsonValue;
    if (pointers.length === 1) {
      keyValue = keyValues[0] as JsonValue;
    } else {
      const obj: Record<string, JsonValue> = {};
      pointers.forEach((p, i) => {
        obj[p] = keyValues[i] as JsonValue;
      });
      keyValue = obj;
    }
    const ck = canonicalKey(keyValue);
    const existing = map.get(ck);
    if (existing) existing.count += 1;
    else map.set(ck, { key: keyValue, count: 1 });
  }

  const wrapsPrimitive =
    pointers.length === 1 &&
    (pointers[0] === '$primitive_value' || pointers[0] === '/$primitive_value' || pointers[0] === '');
  let buckets: CountBucket[] = Array.from(map.values()).map((b) => ({
    key: wrapsPrimitive ? wrapKey(b.key) : b.key,
    count: b.count,
  }));

  if (opts.orderBy) {
    // Sort by /key/<pointer> or /count.
    const sortKeys = parseOrderBy(opts.orderBy).map((k) => {
      // Bucket has shape { key: ..., count: number }. Pointers like /count or /key/<sub>
      return { pointer: k.pointer, direction: k.direction };
    });
    buckets = sortByKeys(buckets as unknown as JsonValue[], sortKeys) as unknown as CountBucket[];
  }

  const offset = opts.offset && opts.offset > 0 ? opts.offset : 0;
  const limit = opts.limit === undefined ? -1 : opts.limit;
  if (limit >= 0) {
    buckets = buckets.slice(offset, offset + limit);
  } else if (offset > 0) {
    buckets = buckets.slice(offset);
  }

  return {
    totalAfterFilter,
    groupBy: opts.groupBy,
    buckets,
  };
}

/**
 * For single-pointer groupBy on primitive elements, the protocol shows the key wrapped
 * as `{ "$primitive_value": "x" }` when the underlying field is itself the primitive.
 * For object fields and other cases we keep the raw value.
 */
function wrapKey(value: JsonValue): JsonValue {
  return { $primitive_value: value };
}
