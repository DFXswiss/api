import { SelectQueryBuilder } from 'typeorm';

/**
 * An explicit field list for a read path, together with the joins it needs.
 *
 * A value rather than a chain of calls at the call site, so that the mutation test can re-run the
 * production query with one field removed instead of rebuilding it. `select` inside `find` options
 * would not do: it narrows the root entity but still pulls in the eager relations.
 *
 * Field names are what the query builder expects: `alias.property`, where `alias` is the root alias
 * or one declared in `joins`.
 */
export class ReadProjection<E> {
  constructor(
    readonly alias: string,
    /**
     * `[relation path, alias]` or `[relation path, alias, 'inner']`, applied in order. A later join
     * may build on an earlier alias. Joins belong here rather than at the query: the guard derives
     * what it watches from this list, so a relation joined on the builder instead is not watched.
     */
    readonly joins: ReadonlyArray<readonly [string, string] | readonly [string, string, 'inner']>,
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
  ) {
    const declared = new Set([alias, ...joins.map(([, joinAlias]) => joinAlias)]);
    const undeclared = [...new Set([...fields, ...guards].map((field) => field.split('.')[0]))].filter(
      (fieldAlias) => !declared.has(fieldAlias),
    );

    if (undeclared.length)
      throw new Error(
        `projection '${alias}' names aliases it does not join: ${undeclared.map((a) => `'${a}'`).join(', ')} — ` +
          `declare them here rather than on the query builder, or the guard does not watch them`,
      );
  }

  /**
   * Applies the joins and the field list to a query builder.
   *
   * `fields` defaults to the declared list; the mutation test passes a reduced one. Guards and joins
   * are applied either way — dropping a field must change the selected columns and nothing else, or
   * the test would be measuring the join instead of the projection.
   */
  apply(query: SelectQueryBuilder<E>, fields: ReadonlyArray<string> = this.fields): SelectQueryBuilder<E> {
    for (const [path, alias, kind] of this.joins) {
      if (kind === 'inner') query.innerJoin(path, alias);
      else query.leftJoin(path, alias);
    }
    return query.select([...fields, ...this.guards]);
  }
}
