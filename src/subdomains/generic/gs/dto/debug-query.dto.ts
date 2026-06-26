import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Structured /gs/debug DTO.
//
// The endpoint accepts a JSON description of a query and emits SQL via TypeORM QueryBuilder
// with parameter binding. No raw SQL ever crosses the wire; identifiers are pulled from
// DebugAllowedColumns in gs.dto.ts, and values flow exclusively through bound parameters.
//
// This is deliberately a narrow surface — every shape the executor can produce is enumerated
// here. To add functionality (CASE, window funcs, OR-with-NOT-NULL, …) extend the schema
// explicitly. There is no escape hatch.

// Maximum nesting depth of a WHERE tree (and/or/not nesting). Validated in the service.
export const DebugQueryMaxWhereDepth = 5;
// Maximum total number of leaf predicates across the entire WHERE tree. Counted in the
// service walker; covers all-leaf trees.
export const DebugQueryMaxPredicates = 50;
// Maximum children of a single AND/OR node. Bounds the body parse + class-validator pass
// before the depth/predicate walk runs, so an attacker can't burn CPU on a deeply-recursive
// validation pass. Combined with `DebugQueryMaxWhereDepth = 5` this gives at most 5^5 = 3125
// internal nodes in the worst case; the predicate-count cap above further bounds the leaves
// to 50. 5 children per AND/OR is comfortably more than realistic debug queries need.
export const DebugQueryMaxAndOrChildren = 5;
// Maximum number of values inside an IN / NOT IN list.
export const DebugQueryMaxInListSize = 100;

export enum DebugAggregate {
  COUNT = 'count',
  SUM = 'sum',
  MIN = 'min',
  MAX = 'max',
  AVG = 'avg',
}

export enum DebugWhereOp {
  EQ = '=',
  NE = '!=',
  LT = '<',
  LE = '<=',
  GT = '>',
  GE = '>=',
  IN = 'IN',
  NOT_IN = 'NOT IN',
  LIKE = 'LIKE',
  ILIKE = 'ILIKE',
  IS_NULL = 'IS NULL',
  IS_NOT_NULL = 'IS NOT NULL',
}

// Identifier regex used everywhere an alias or jsonb path segment appears. Same shape as
// the camelCase column names the entities use; no quotes, no dots, no spaces. Length cap
// prevents pathological inputs from reaching SQL even if a future bug skipped a length check.
export const DebugIdentifierRegex = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// A SELECT item is one of three shapes, distinguished by the `kind` discriminator. Class-
// validator is told the kind via @IsIn so a missing/wrong discriminator rejects fast.
export class DebugSelectItem {
  @IsIn(['column', 'jsonb', 'aggregate'])
  kind: 'column' | 'jsonb' | 'aggregate';

  // Source column. Required for all three kinds. Validated against the table allowlist in
  // the service (it needs the table to know which allowlist to check).
  @IsString()
  @Matches(DebugIdentifierRegex)
  column: string;

  // Optional output alias. If set, must match DebugIdentifierRegex (we emit it as a
  // double-quoted identifier in SQL). Aliases are also consulted when validating ORDER BY.
  @IsOptional()
  @IsString()
  @Matches(DebugIdentifierRegex)
  as?: string;

  // Aggregate selector (only when kind === 'aggregate').
  @IsOptional()
  @IsEnum(DebugAggregate)
  aggregate?: DebugAggregate;

  // jsonb path (only when kind === 'jsonb'). Dot-separated segments; each segment must
  // match DebugIdentifierRegex. Segments map to alternating `->` (for all but the last) and
  // `->>` (for the terminal), so the resulting expression is text.
  @IsOptional()
  @IsString()
  @MaxLength(256)
  jsonbPath?: string;
}

// A WHERE node is one of four shapes. Same `kind` discriminator approach as SelectItem;
// each kind populates a different subset of the fields below. Cross-field consistency
// (e.g. "kind=and requires children non-empty") is checked in the service walker.
export class DebugWhereNode {
  @IsIn(['leaf', 'and', 'or', 'not'])
  kind: 'leaf' | 'and' | 'or' | 'not';

  // Children for 'and' / 'or'. Recursive — but the per-level cap (DebugQueryMaxAndOrChildren)
  // bounds the validator pass before the service's depth and predicate caps run, so a
  // pathologically wide-and-deep request can't burn CPU on class-validator alone.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DebugQueryMaxAndOrChildren)
  @ValidateNested({ each: true })
  @Type(() => DebugWhereNode)
  children?: DebugWhereNode[];

  // Child for 'not'.
  @IsOptional()
  @ValidateNested()
  @Type(() => DebugWhereNode)
  child?: DebugWhereNode;

  // Leaf fields. All three are required when kind === 'leaf' (except value, which is
  // forbidden for IS NULL / IS NOT NULL).
  @IsOptional()
  @IsString()
  @Matches(DebugIdentifierRegex)
  column?: string;

  @IsOptional()
  @IsEnum(DebugWhereOp)
  op?: DebugWhereOp;

  // Leaf value. Strings, numbers, booleans, or arrays thereof (for IN / NOT IN). Bound as
  // a parameter — not interpolated. We don't decorate with class-validator type checks here
  // because the leaf walker validates the shape against op (e.g. IN must get an array).
  @IsOptional()
  value?: string | number | boolean | (string | number | boolean)[];
}

export class DebugOrderByItem {
  // Either a column name (must be in the table allowlist) OR an alias declared earlier in
  // `select` (matched case-sensitively against the `as` values collected by the service).
  // The service decides which, so this field accepts the same identifier shape for both.
  @IsString()
  @Matches(DebugIdentifierRegex)
  column: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  direction?: 'ASC' | 'DESC';
}

export class DebugQueryDto {
  // Table to query. Must be a key in DebugAllowedColumns.
  @IsString()
  @Matches(/^[a-z_][a-z0-9_]{0,63}$/)
  table: string;

  // SELECT items. At least one; capped at 100 to bound the response width.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DebugSelectItem)
  select: DebugSelectItem[];

  // WHERE tree. Optional. If absent, the SQL has no WHERE clause.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DebugWhereNode)
  where?: DebugWhereNode;

  // GROUP BY columns. Must reference columns in the table allowlist or aliases from
  // `select` (the service decides). Order matters — emitted left-to-right.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(DebugIdentifierRegex, { each: true })
  groupBy?: string[];

  // ORDER BY items. Each may reference a table column or a select-alias.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DebugOrderByItem)
  orderBy?: DebugOrderByItem[];

  // LIMIT cap. Required; the service additionally clamps to DebugMaxResults.
  @IsInt()
  @Min(1)
  @Max(10000)
  limit: number;

  // OFFSET. Optional. Same int constraints as limit but allowed to be 0.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  offset?: number;
}

export class DebugQueryResult {
  // Column names in result order. Mirrors the `as`-or-column ordering of the `select` array.
  keys: string[];
  // Row values, parallel to `keys`.
  rows: unknown[][];
}
