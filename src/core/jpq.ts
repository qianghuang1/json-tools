/**
 * JPQ execution engine. See docs/jpq-protocol.md.
 *
 * The engine is pure: it consumes a JSON document and a request, returns the response
 * document plus optional `$counts` and `$errors` siblings. File I/O is handled elsewhere.
 */

import { computeCount, GroupByError } from './count';
import { evaluateWhere, FilterError } from './filter';
import { parsePointer, PointerError, resolvePointer, setAtPointer, joinPointer, escapeToken } from './pointer';
import { attachArrayIndex, wrapRootIfNeeded } from './provenance';
import { applySelect, parseSelect, SelectError } from './select';
import { parseOrderBy, sortByKeys, OrderByError } from './sort';
import type { CountResult, JpqError, JpqOperation, JpqRequest, JsonValue } from './types';

export interface JpqResponse {
  document: JsonValue;
  counts: Record<string, CountResult>;
  errors: Record<string, JpqError>;
}

interface ProcessResult {
  decoratedSlice: JsonValue[];
  counts: Record<string, CountResult>;
  errors: Record<string, JpqError>;
}

function toJpqError(err: unknown): JpqError {
  if (err instanceof PointerError) return { code: err.code, message: err.message };
  if (err instanceof FilterError) return { code: 'BAD_FILTER', message: err.message };
  if (err instanceof OrderByError) return { code: 'BAD_ORDER_BY', message: err.message };
  if (err instanceof SelectError) return { code: 'BAD_SELECT', message: err.message };
  if (err instanceof GroupByError) return { code: 'BAD_GROUP_BY', message: err.message };
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}

/**
 * Process one operation against the document, returning the decorated array slice
 * (with `$array_index` injected and any nested `expand` applied to children), plus
 * any counts/errors keyed by the operation's absolute pointer.
 */
function processOperation(
  document: JsonValue,
  operation: JpqOperation,
  absolutePointer: string,
): ProcessResult {
  const counts: Record<string, CountResult> = {};
  const errors: Record<string, JpqError> = {};

  // 1. Resolve target array.
  let target: JsonValue | undefined;
  try {
    target = resolvePointer(document, operation.path ?? '');
  } catch (err) {
    errors[absolutePointer] = toJpqError(err);
    return { decoratedSlice: [], counts, errors };
  }
  if (target === undefined) {
    errors[absolutePointer] = {
      code: 'PATH_NOT_FOUND',
      message: `Pointer ${operation.path ?? '""'} does not exist.`,
    };
    return { decoratedSlice: [], counts, errors };
  }
  if (!Array.isArray(target)) {
    errors[absolutePointer] = {
      code: 'PATH_NOT_ARRAY',
      message: `Pointer ${operation.path ?? '""'} resolves to ${typeof target}, expected array.`,
    };
    return { decoratedSlice: [], counts, errors };
  }

  // 2. Decorate every element with $array_index and a stable original-index reference.
  // Provenance attachment uses the original index. We keep "original element" + decorated
  // form together so where/orderBy can run against the decorated value while expand can
  // recurse into the original child arrays of the decorated element.
  const decoratedAll: JsonValue[] = target.map((el, i) => attachArrayIndex(el, i));

  // 3. Filter.
  let filtered: JsonValue[];
  try {
    filtered = decoratedAll.filter((el) => evaluateWhere(el, operation.where));
  } catch (err) {
    errors[absolutePointer] = toJpqError(err);
    return { decoratedSlice: [], counts, errors };
  }

  // 4. Counts (computed on the filtered universe, before sort/page).
  if (operation.count) {
    try {
      const c = computeCount(filtered, operation.count);
      if (c) counts[absolutePointer] = c;
    } catch (err) {
      errors[absolutePointer] = toJpqError(err);
      return { decoratedSlice: [], counts, errors };
    }
  }

  // 5. Sort.
  let sorted: JsonValue[];
  try {
    const keys = parseOrderBy(operation.orderBy);
    sorted = sortByKeys(filtered, keys);
  } catch (err) {
    errors[absolutePointer] = toJpqError(err);
    return { decoratedSlice: [], counts, errors };
  }

  // 6. Page.
  const offset = operation.offset && operation.offset > 0 ? operation.offset : 0;
  const limit = operation.limit === undefined ? 5 : operation.limit;
  let paged: JsonValue[];
  if (limit === 0) {
    paged = [];
  } else if (limit < 0) {
    paged = sorted.slice(offset);
  } else {
    paged = sorted.slice(offset, offset + limit);
  }

  // 7. Expand: for each remaining decorated element, run nested operations against its
  // child arrays in place. The pointer is relative to the element.
  if (operation.expand && operation.expand.length > 0) {
    paged = paged.map((element) => {
      let next: JsonValue = element;
      for (const childOp of operation.expand!) {
        const childPointer = childOp.path ?? '';
        const childAbsolute = joinPointer(absolutePointer, '?expand', childPointer);
        const childTarget = resolvePointer(next, childPointer);
        if (childTarget === undefined) {
          errors[childAbsolute] = {
            code: 'PATH_NOT_FOUND',
            message: `Expand pointer ${childPointer} not found within element.`,
          };
          continue;
        }
        if (!Array.isArray(childTarget)) {
          errors[childAbsolute] = {
            code: 'PATH_NOT_ARRAY',
            message: `Expand pointer ${childPointer} is not an array.`,
          };
          continue;
        }
        const childResult = processOperation(next, childOp, childAbsolute);
        Object.assign(counts, childResult.counts);
        Object.assign(errors, childResult.errors);
        try {
          next = setAtPointer(next, childPointer, childResult.decoratedSlice);
        } catch (err) {
          errors[childAbsolute] = toJpqError(err);
        }
      }
      return next;
    });
  }

  // 8. Select projection: keeps `$array_index` and only requested fields for
  // plain-object elements. Wrapped elements are left unchanged.
  try {
    const selectPointers = parseSelect(operation.select);
    paged = applySelect(paged, selectPointers);
  } catch (err) {
    errors[absolutePointer] = toJpqError(err);
    return { decoratedSlice: [], counts, errors };
  }

  return { decoratedSlice: paged, counts, errors };
}

/**
 * Execute a JPQ request against a document. Pure function — no I/O.
 */
export function executeJpq(document: JsonValue, request: JpqRequest): JpqResponse {
  if (request.all) {
    return { document, counts: {}, errors: {} };
  }

  const operations = request.operations ?? [];

  let result: JsonValue = document;
  const counts: Record<string, CountResult> = {};
  const errors: Record<string, JpqError> = {};

  for (const op of operations) {
    const absolutePointer = op.path ?? '';
    const opResult = processOperation(document, op, absolutePointer);
    Object.assign(counts, opResult.counts);
    Object.assign(errors, opResult.errors);
    if (errors[absolutePointer]) continue;
    try {
      result = setAtPointer(result, absolutePointer, opResult.decoratedSlice);
    } catch (err) {
      errors[absolutePointer] = toJpqError(err);
    }
  }

  // §8.5: wrap document if reserved top-level keys collide.
  const willEmitCounts = Object.keys(counts).length > 0;
  const willEmitErrors = Object.keys(errors).length > 0;
  const reserved: string[] = [];
  if (willEmitCounts) reserved.push('$counts');
  if (willEmitErrors) reserved.push('$errors');
  if (reserved.length > 0) {
    result = wrapRootIfNeeded(result, reserved);
  }

  return { document: result, counts, errors };
}

/**
 * Convenience: returns the final response document with `$counts` and `$errors` baked in
 * as top-level keys (if any), per §8.
 */
export function buildResponseDocument(response: JpqResponse): JsonValue {
  const out: JsonValue =
    response.document &&
    typeof response.document === 'object' &&
    !Array.isArray(response.document)
      ? { ...(response.document as Record<string, JsonValue>) }
      : response.document;

  if (Object.keys(response.counts).length > 0) {
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      (out as Record<string, JsonValue>).$counts = response.counts as unknown as JsonValue;
    }
  }
  if (Object.keys(response.errors).length > 0) {
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      (out as Record<string, JsonValue>).$errors = response.errors as unknown as JsonValue;
    }
  }
  return out;
}

// Re-export for `escapeToken` users.
export { escapeToken };
