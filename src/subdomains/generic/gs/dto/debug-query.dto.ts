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
  registerDecorator,
  ValidateNested,
  ValidationOptions,
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

// Maximum nesting depth of a WHERE tree (and/or/not nesting). Enforced at the DTO layer
// by `@MaxWhereTreeSize` (iterative walk, so the tree is rejected by ValidationPipe before
// the audit log's JSON.stringify can stack-overflow on it) and re-enforced by the service
// walker.
export const DebugQueryMaxWhereDepth = 5;
// Maximum total number of nodes in the WHERE tree (internal AND/OR/NOT + leaves), enforced
// at the DTO layer by `@MaxWhereTreeSize`. A linear NOT-chain has no children-width cap, so
// this is the only thing that bounds it before the recursive walk fires.
export const DebugQueryMaxWhereNodes = 200;
// Maximum total number of leaf predicates across the entire WHERE tree. Counted in the
// service walker; covers all-leaf trees.
export const DebugQueryMaxPredicates = 50;
// Maximum children of a single AND/OR node. Bounds the body parse + class-validator pass
// for AND/OR branching; combined with `DebugQueryMaxWhereDepth = 5` and the node-count cap
// above, an attacker can't burn CPU on a deeply-recursive validation pass.
export const DebugQueryMaxAndOrChildren = 5;
// Maximum number of values inside an IN / NOT IN list.
export const DebugQueryMaxInListSize = 100;

// Iterative walker for the WHERE tree — used inside the custom class-validator constraint
// below. Cannot use recursion: a malicious linear `not → child → not → …` chain would
// stack-overflow the validator itself (which is what we're trying to prevent).
export function walkWhereTreeIteratively(root: unknown): { depth: number; nodes: number } {
  let maxDepth = 0;
  let nodeCount = 0;
  // Stack entries are (node, depth). Depth starts at 1 for the root.
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== 'object') continue;
    nodeCount++;
    if (depth > maxDepth) maxDepth = depth;
    // Early-out if we've already exceeded the caps — bound the work to O(cap).
    if (nodeCount > DebugQueryMaxWhereNodes || maxDepth > DebugQueryMaxWhereDepth) {
      return { depth: maxDepth, nodes: nodeCount };
    }
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) stack.push({ node: child, depth: depth + 1 });
    }
    if (obj.child !== undefined) {
      stack.push({ node: obj.child, depth: depth + 1 });
    }
  }
  return { depth: maxDepth, nodes: nodeCount };
}

// Class-validator decorator that enforces depth + node-count caps on a WHERE-tree-shaped
// value at the DTO layer. The walk is iterative — recursion here would defeat the point.
export function MaxWhereTreeSize(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'maxWhereTreeSize',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return true;
          const { depth, nodes } = walkWhereTreeIteratively(value);
          return depth <= DebugQueryMaxWhereDepth && nodes <= DebugQueryMaxWhereNodes;
        },
        defaultMessage(): string {
          return (
            `WHERE tree exceeds caps (max depth ${DebugQueryMaxWhereDepth}, ` + `max ${DebugQueryMaxWhereNodes} nodes)`
          );
        },
      },
    });
  };
}

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
  //
  // The `DebugQueryTreeSizeMiddleware` (registered in `GsModule.configure`) runs BEFORE the
  // global `ValidationPipe`, so a malicious `not → child → not → …` chain that would
  // stack-overflow class-transformer's `@Type`-driven recursion (and the audit log's
  // `JSON.stringify`) is rejected with a clean 400 before any of that runs.
  // `@MaxWhereTreeSize` here is a belt-and-braces downstream check on the instantiated
  // tree (the middleware is the load-bearing one).
  @IsOptional()
  @MaxWhereTreeSize()
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
