/**
 * Where-clause evaluation per JPQ §5.
 */

import { resolveRelative } from './pointer';
import type { JsonValue, WhereClause, ComparisonClause, ComparisonOp } from './types';

export class FilterError extends Error {
  code = 'BAD_FILTER';
  constructor(message: string) {
    super(message);
  }
}

const COMPARISON_OPS: ReadonlySet<ComparisonOp> = new Set([
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'nin',
  'contains',
  'startsWith',
  'endsWith',
  'regex',
  'exists',
  'isNull',
]);

function isComparison(clause: WhereClause): clause is ComparisonClause {
  return (
    typeof clause === 'object' &&
    clause !== null &&
    'op' in clause &&
    'field' in clause
  );
}

function compare(left: JsonValue | undefined, right: JsonValue | undefined): number | null {
  if (left === right) return 0;
  if (left === undefined || left === null) return null;
  if (right === undefined || right === null) return null;
  const lt = typeof left;
  const rt = typeof right;
  if (lt !== rt) return null;
  if (lt === 'number' || lt === 'string' || lt === 'boolean') {
    return left < (right as typeof left) ? -1 : left > (right as typeof left) ? 1 : 0;
  }
  return null;
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, JsonValue>;
  const bo = b as Record<string, JsonValue>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

const REGEX_TIMEOUT_MS = 100;

function safeRegexTest(pattern: string, value: string): boolean {
  // node:vm based timeout would be ideal; fall back to simple length cap as a basic guard.
  // Catastrophic backtracking guards are best-effort here.
  if (value.length > 100_000) return false;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    throw new FilterError(`Invalid regex: ${(err as Error).message}`);
  }
  const start = Date.now();
  const result = regex.test(value);
  if (Date.now() - start > REGEX_TIMEOUT_MS) {
    throw new FilterError(`Regex evaluation exceeded ${REGEX_TIMEOUT_MS}ms`);
  }
  return result;
}

function evalComparison(element: JsonValue, clause: ComparisonClause): boolean {
  const fieldValue = resolveRelative(element, clause.field);
  const expected = clause.value;

  switch (clause.op) {
    case 'exists':
      return fieldValue !== undefined;
    case 'isNull':
      return fieldValue === null;
    case 'eq':
      return deepEqual(fieldValue, expected);
    case 'ne':
      return !deepEqual(fieldValue, expected);
    case 'lt': {
      const c = compare(fieldValue, expected);
      return c !== null && c < 0;
    }
    case 'lte': {
      const c = compare(fieldValue, expected);
      return c !== null && c <= 0;
    }
    case 'gt': {
      const c = compare(fieldValue, expected);
      return c !== null && c > 0;
    }
    case 'gte': {
      const c = compare(fieldValue, expected);
      return c !== null && c >= 0;
    }
    case 'in':
      if (!Array.isArray(expected)) {
        throw new FilterError(`'in' operator requires an array value for field ${clause.field}`);
      }
      return expected.some((candidate) => deepEqual(fieldValue, candidate));
    case 'nin':
      if (!Array.isArray(expected)) {
        throw new FilterError(`'nin' operator requires an array value for field ${clause.field}`);
      }
      return !expected.some((candidate) => deepEqual(fieldValue, candidate));
    case 'contains':
      if (typeof fieldValue === 'string' && typeof expected === 'string') {
        return fieldValue.includes(expected);
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => deepEqual(v, expected));
      }
      return false;
    case 'startsWith':
      return typeof fieldValue === 'string' && typeof expected === 'string' && fieldValue.startsWith(expected);
    case 'endsWith':
      return typeof fieldValue === 'string' && typeof expected === 'string' && fieldValue.endsWith(expected);
    case 'regex': {
      if (typeof fieldValue !== 'string' || typeof expected !== 'string') return false;
      return safeRegexTest(expected, fieldValue);
    }
    default:
      throw new FilterError(`Unknown comparison op: ${(clause as { op: string }).op}`);
  }
}

export function evaluateWhere(element: JsonValue, where: WhereClause | undefined): boolean {
  if (where === undefined) return true;
  if (typeof where !== 'object' || where === null) {
    throw new FilterError('where must be an object');
  }
  if ('and' in where) {
    if (!Array.isArray(where.and)) throw new FilterError('"and" must be an array');
    return where.and.every((c) => evaluateWhere(element, c));
  }
  if ('or' in where) {
    if (!Array.isArray(where.or)) throw new FilterError('"or" must be an array');
    return where.or.some((c) => evaluateWhere(element, c));
  }
  if ('not' in where) {
    return !evaluateWhere(element, where.not);
  }
  if (isComparison(where)) {
    if (!COMPARISON_OPS.has(where.op)) {
      throw new FilterError(`Unknown comparison op: ${where.op}`);
    }
    return evalComparison(element, where);
  }
  throw new FilterError('where clause must contain "and", "or", "not", or a comparison');
}
