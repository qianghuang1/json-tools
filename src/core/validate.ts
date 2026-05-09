/**
 * AJV-based JPQ request validation with friendly error messages.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { ALL_SCHEMAS, requestSchema, operationSchema } from './schemas';
import type { JpqOperation, JpqRequest } from './types';

export class ValidationError extends Error {
  code = 'VALIDATION_FAILED';
  details: string[];
  constructor(message: string, details: string[]) {
    super(message);
    this.details = details;
  }
}

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);
for (const schema of ALL_SCHEMAS) {
  if (!ajv.getSchema(schema.$id)) {
    ajv.addSchema(schema);
  }
}

const validateRequest: ValidateFunction = ajv.getSchema('jpq:request')!;
const validateOperation: ValidateFunction = ajv.getSchema('jpq:operation')!;

function formatErrors(errors: ErrorObject[] | null | undefined, root: string): string[] {
  if (!errors) return [];
  return errors.map((err) => {
    const path = `${root}${err.instancePath || ''}`;
    let detail = err.message ?? 'invalid';
    if (err.keyword === 'additionalProperties') {
      const extra = (err.params as { additionalProperty?: string }).additionalProperty;
      detail = `unknown property "${extra}"`;
    } else if (err.keyword === 'enum') {
      const allowed = (err.params as { allowedValues?: unknown[] }).allowedValues;
      detail = `must be one of ${JSON.stringify(allowed)}`;
    } else if (err.keyword === 'type') {
      detail = `must be ${(err.params as { type?: string }).type}`;
    } else if (err.keyword === 'required') {
      detail = `missing required property "${(err.params as { missingProperty?: string }).missingProperty}"`;
    }
    return `${path || '(root)'}: ${detail}`;
  });
}

export function validateJpqRequest(value: unknown): JpqRequest {
  const ok = validateRequest(value);
  if (!ok) {
    const details = formatErrors(validateRequest.errors, '$');
    throw new ValidationError(
      `Invalid JPQ request:\n  - ${details.join('\n  - ')}`,
      details,
    );
  }
  return value as JpqRequest;
}

export function validateJpqOperation(value: unknown, label = '$'): JpqOperation {
  const ok = validateOperation(value);
  if (!ok) {
    const details = formatErrors(validateOperation.errors, label);
    throw new ValidationError(
      `Invalid JPQ operation:\n  - ${details.join('\n  - ')}`,
      details,
    );
  }
  return value as JpqOperation;
}

export function validateJpqOperations(values: unknown[]): JpqOperation[] {
  return values.map((value, index) => validateJpqOperation(value, `$.operations[${index}]`));
}
