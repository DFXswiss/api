import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { AccountType } from '../entities/ledger-account.entity';
import { LedgerLeg } from '../entities/ledger-leg.entity';

/** What `LedgerDtoMapper.mapSuspenseLeg` reads, including the booking date the age is computed from. */
export const SUSPENSE_LEG_RESPONSE_FIELDS = [
  'leg.id',
  'leg.amount',
  'leg.amountChf',
  'tx.bookingDate',
  'tx.description',
  'tx.sourceType',
  'tx.sourceId',
  'account.currency',
];

/**
 * `GET /dashboard/accounting/ledger/suspense`.
 *
 * The query joined the transaction and the account with `innerJoinAndSelect`, which loads each of
 * them whole for four values and a currency.
 *
 * `tx.id` and `account.id` are guards: the response never shows them, but without a primary key the
 * ORM cannot materialise a joined row — and `leg.txId` is a `@RelationId`, resolved from the joined
 * transaction rather than from a column of its own.
 *
 * The two joins stay with the query rather than moving into the projection: `ReadProjection` joins
 * left, and these are inner. Both relations are `nullable: false`, so the two forms select the same
 * rows today — but that is a property of the schema, and the query should not depend on it silently.
 */
export const SUSPENSE_LEG_PROJECTION = new ReadProjection<LedgerLeg>('leg', [], SUSPENSE_LEG_RESPONSE_FIELDS, [
  'tx.id',
  'account.id',
]);

@Injectable()
export class LedgerLegRepository extends BaseRepository<LedgerLeg> {
  constructor(manager: EntityManager) {
    super(LedgerLeg, manager);
  }

  /**
   * The legs sitting on suspense accounts, oldest booking first.
   *
   * `fields` exists for the mutation test; nothing in production passes it.
   */
  async findSuspenseLegs(fields: ReadonlyArray<string> = SUSPENSE_LEG_PROJECTION.fields): Promise<LedgerLeg[]> {
    return SUSPENSE_LEG_PROJECTION.apply(
      this.createQueryBuilder('leg').innerJoin('leg.tx', 'tx').innerJoin('leg.account', 'account'),
      fields,
    )
      .where('account.type = :type', { type: AccountType.SUSPENSE })
      .orderBy('tx.bookingDate', 'ASC')
      .getMany();
  }
}
