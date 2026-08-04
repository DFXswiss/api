import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import { EntityManager, SelectQueryBuilder } from 'typeorm';
import { SupportMessage } from '../entities/support-message.entity';

/**
 * What `SupportIssueDtoMapper.mapSupportMessage` reads.
 *
 * `fileName` is a getter over `fileUrl`, so the column is what has to be selected. Naming the getter
 * here does not fail loudly: the ORM does not recognise it as a column, passes the expression
 * through unquoted, and Postgres then rejects the statement with a missing FROM-clause entry for a
 * lower-cased table name that appears nowhere in the query.
 */
export const SUPPORT_MESSAGE_RESPONSE_FIELDS = [
  'supportMessage.id',
  'supportMessage.author',
  'supportMessage.created',
  'supportMessage.message',
  'supportMessage.fileUrl',
];

/** What the list rows show about the messages of an issue. */
export interface SupportMessageStats {
  count: number;
  lastDate?: Date;
  lastAuthor?: string;
}

/**
 * The message thread of an issue.
 *
 * Loaded on its own rather than as a relation of the issue.
 */
export const SUPPORT_MESSAGE_PROJECTION = new ReadProjection<SupportMessage>(
  'supportMessage',
  [['supportMessage.issue', 'messageIssue']],
  SUPPORT_MESSAGE_RESPONSE_FIELDS,
);

@Injectable()
export class SupportMessageRepository extends BaseRepository<SupportMessage> {
  constructor(manager: EntityManager) {
    super(SupportMessage, manager);
  }

  /**
   * The messages of an issue, newer than `fromMessageId`.
   *
   * `fields` is what the mutation test in `support-issue-view.projection.spec.ts` re-runs the query
   * with; `SupportIssueService.getIssue` calls this without it.
   */
  async findThread(
    issueId: number,
    fromMessageId = 0,
    fields: ReadonlyArray<string> = SUPPORT_MESSAGE_PROJECTION.fields,
  ): Promise<SupportMessage[]> {
    return (
      SUPPORT_MESSAGE_PROJECTION.apply(this.createQueryBuilder('supportMessage'), fields)
        .where('messageIssue.id = :issueId', { issueId })
        // Written out rather than as `{ id: MoreThan(...) }`: the object form is resolved against the
        // find-options alias, not the query builder's, and the statement then refers to a table that
        // is not in its FROM clause.
        .andWhere('supportMessage.id > :fromMessageId', { fromMessageId })
        .getMany()
    );
  }

  /**
   * Message count, last date and last author per issue, for the list rows.
   *
   * Its own aggregate rather than part of the list query: the list is paginated, and joining the
   * messages would multiply the rows before the page is cut.
   */
  async findStatsFor(issueIds: number[]): Promise<Map<number, SupportMessageStats>> {
    if (issueIds.length === 0) return new Map();

    // The newest message per issue, as a correlated subquery. One factory for the two columns the
    // row shows, so the two subqueries cannot drift apart.
    const lastOf =
      (
        column: 'created' | 'author',
      ): ((sub: SelectQueryBuilder<SupportMessage>) => SelectQueryBuilder<SupportMessage>) =>
      (sub: SelectQueryBuilder<SupportMessage>): SelectQueryBuilder<SupportMessage> =>
        sub
          .select(`m2.${column}`)
          .from(SupportMessage, 'm2')
          .where('m2."issueId" = m."issueId"')
          .orderBy('m2.id', 'DESC')
          .limit(1);

    // Batched to stay below the parameter limit of a single statement.
    const rows = await Util.doInBatchesAndJoin(
      issueIds,
      (chunk): Promise<{ issueId: string; count: string; lastDate: Date | null; lastAuthor: string | null }[]> =>
        this.createQueryBuilder('m')
          .select('m."issueId"', 'issueId')
          .addSelect('COUNT(*)', 'count')
          .addSelect(lastOf('created'), 'lastDate')
          .addSelect(lastOf('author'), 'lastAuthor')
          .where('m."issueId" IN (:...ids)', { ids: chunk })
          .groupBy('m."issueId"')
          .getRawMany(),
      1000,
    );

    return new Map(
      rows.map((row) => [
        +row.issueId,
        { count: +row.count, lastDate: row.lastDate ?? undefined, lastAuthor: row.lastAuthor ?? undefined },
      ]),
    );
  }
}
