import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { AccountType } from 'src/subdomains/core/accounting/entities/ledger-account.entity';
import { LedgerLeg } from '../entities/ledger-leg.entity';

/** What `LedgerDtoMapper.mapSuspenseLeg` reads, including the booking date the age is computed from. */
export const SUSPENSE_LEG_RESPONSE_FIELDS = [
  'leg.id',
  // `mapSuspenseLeg` answers with this as `txId`, read off the joined row rather than through the
  // entity's `@RelationId` — that property is filled from the leg's foreign-key column, which a
  // query naming its fields does not carry.
  'tx.id',
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
 * `account.id` is a guard: without a primary key the ORM cannot materialise the joined row.
 *
 * Both joins are inner: a leg without a transaction or an account is not a suspense entry.
 */
export const SUSPENSE_LEG_PROJECTION = new ReadProjection<LedgerLeg>(
  'leg',
  [
    ['leg.tx', 'tx', 'inner'],
    ['leg.account', 'account', 'inner'],
  ],
  SUSPENSE_LEG_RESPONSE_FIELDS,
  ['account.id'],
);

@Injectable()
export class LedgerLegRepository extends BaseRepository<LedgerLeg> {
  constructor(manager: EntityManager) {
    super(LedgerLeg, manager);
  }

  /**
   * The legs sitting on suspense accounts, oldest booking first.
   *
   * `fields` is what the mutation test in `ledger-suspense.projection.spec.ts` re-runs the query
   * with; `LedgerQueryService.getSuspense` calls this without it.
   */
  async findSuspenseLegs(fields: ReadonlyArray<string> = SUSPENSE_LEG_PROJECTION.fields): Promise<LedgerLeg[]> {
    return SUSPENSE_LEG_PROJECTION.apply(this.createQueryBuilder('leg'), fields)
      .where('account.type = :type', { type: AccountType.SUSPENSE })
      .orderBy('tx.bookingDate', 'ASC')
      .getMany();
  }
}
