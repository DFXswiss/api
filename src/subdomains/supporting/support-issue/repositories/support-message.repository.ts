import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
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

/**
 * The message thread of an issue.
 *
 * Loaded on its own rather than as a relation, which is what the endpoint already did — the
 * projection only narrows the columns.
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
   * `fields` exists for the mutation test; nothing in production passes it.
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
}
