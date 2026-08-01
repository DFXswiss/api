import { SelectQueryBuilder } from 'typeorm';

/**
 * An explicit field list for a read path, together with the joins it needs.
 *
 * Two reasons this is a value rather than a chain of `.leftJoin().select()` calls at the call site:
 *
 * 1. `select` inside `find` options narrows the root entity but still pulls in the eager relations,
 *    so a projection has to go through a query builder. Wrapping that keeps the call sites short.
 * 2. The mutation test (level 3 in `docs/read-path-projections.md`) has to run the *same* query with
 *    one field removed. With the field list as data, the test drives the production code path
 *    instead of rebuilding the query — a second implementation could be wrong in the same way and
 *    would prove nothing.
 *
 * Field names are the ones the query builder expects: `alias.property`, where `alias` is either the
 * root alias or one declared in `joins`.
 */
export class ReadProjection<E> {
  constructor(
    readonly alias: string,
    /** `[relation path, alias]`, applied as left joins in order. A later join may build on an earlier alias. */
    readonly joins: ReadonlyArray<readonly [string, string]>,
    /** Fields that feed the response. These are what the mutation test drops one by one. */
    readonly fields: ReadonlyArray<string>,
    /**
     * Fields the query needs but the response never shows: primary keys that make the ORM
     * materialise a joined relation, and values a guard decides on before the mapper runs.
     *
     * They are kept apart because the mutation test asserts through the response. Dropping a guard
     * changes no response field, so it would be reported as removable although the endpoint breaks
     * without it. Each one needs its own assertion instead — see the specs.
     */
    readonly guards: ReadonlyArray<string> = [],
  ) {}

  /**
   * Applies the joins and the field list to a query builder.
   *
   * `fields` defaults to the declared list; the mutation test passes a reduced one. Guards and joins
   * are applied either way — dropping a field must change the selected columns and nothing else, or
   * the test would be measuring the join instead of the projection.
   */
  apply(query: SelectQueryBuilder<E>, fields: ReadonlyArray<string> = this.fields): SelectQueryBuilder<E> {
    for (const [path, alias] of this.joins) query.leftJoin(path, alias);
    return query.select([...fields, ...this.guards]);
  }
}
