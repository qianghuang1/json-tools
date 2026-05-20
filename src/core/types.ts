/**
 * JPQ — JSON Partial Query Protocol types.
 * See docs/jpq-protocol.md.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ComparisonOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'exists'
  | 'isNull';

export interface ComparisonClause {
  field: string;
  op: ComparisonOp;
  value?: JsonValue;
}

export interface AndClause {
  and: WhereClause[];
}

export interface OrClause {
  or: WhereClause[];
}

export interface NotClause {
  not: WhereClause;
}

export type WhereClause = ComparisonClause | AndClause | OrClause | NotClause;

export interface CountOptions {
  groupBy?: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
  nullKey?: JsonValue;
}

export interface JpqOperation {
  path?: string;
  select?: string;
  where?: WhereClause;
  orderBy?: string;
  offset?: number;
  limit?: number;
  expand?: JpqOperation[];
  count?: boolean | CountOptions;
}

export interface JpqRequest {
  target?: string;
  all?: boolean;
  operations?: JpqOperation[];
}

export interface JpqError {
  code: string;
  message: string;
}

export interface CountBucket {
  key: JsonValue;
  count: number;
}

export interface CountResult {
  totalAfterFilter: number;
  groupBy?: string;
  buckets?: CountBucket[];
}
