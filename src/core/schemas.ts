/**
 * JSON Schemas for JPQ request validation.
 */

import type { JSONSchemaType } from 'ajv';

export const operationSchema = {
  $id: 'jpq:operation',
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    select: { type: 'string' },
    where: { $ref: 'jpq:where' },
    orderBy: { type: 'string' },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer' },
    expand: {
      type: 'array',
      items: { $ref: 'jpq:operation' },
    },
    count: {
      oneOf: [
        { type: 'boolean' },
        { $ref: 'jpq:count' },
      ],
    },
  },
} as const;

export const whereSchema = {
  $id: 'jpq:where',
  type: 'object',
  oneOf: [
    {
      additionalProperties: false,
      required: ['and'],
      properties: {
        and: { type: 'array', items: { $ref: 'jpq:where' } },
      },
    },
    {
      additionalProperties: false,
      required: ['or'],
      properties: {
        or: { type: 'array', items: { $ref: 'jpq:where' } },
      },
    },
    {
      additionalProperties: false,
      required: ['not'],
      properties: {
        not: { $ref: 'jpq:where' },
      },
    },
    {
      additionalProperties: false,
      required: ['field', 'op'],
      properties: {
        field: { type: 'string' },
        op: {
          type: 'string',
          enum: [
            'eq', 'ne', 'lt', 'lte', 'gt', 'gte',
            'in', 'nin', 'contains',
            'startsWith', 'endsWith', 'regex',
            'exists', 'isNull',
          ],
        },
        value: {},
      },
    },
  ],
} as const;

export const countSchema = {
  $id: 'jpq:count',
  type: 'object',
  additionalProperties: false,
  properties: {
    groupBy: { type: 'string' },
    orderBy: { type: 'string' },
    limit: { type: 'integer' },
    offset: { type: 'integer', minimum: 0 },
    nullKey: {},
  },
} as const;

export const requestSchema = {
  $id: 'jpq:request',
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string' },
    all: { type: 'boolean' },
    operations: {
      type: 'array',
      items: { $ref: 'jpq:operation' },
    },
  },
  allOf: [
    {
      if: { properties: { all: { const: true } }, required: ['all'] },
      then: { not: { required: ['operations'] } },
    },
  ],
} as const;

export const ALL_SCHEMAS = [requestSchema, operationSchema, whereSchema, countSchema];
