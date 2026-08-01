import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BuyFiat } from './buy-fiat.entity';

/** The nine values `BuyFiatHistoryMapper.toDto` reads. */
export const BUY_FIAT_HISTORY_RESPONSE_FIELDS = [
  'buyFiat.inputAmount',
  'buyFiat.inputAsset',
  'buyFiat.outputAmount',
  'buyFiat.amlCheck',
  'buyFiat.isComplete',
  'outputAsset.name',
  'cryptoInput.inTxId',
  'cryptoInputAsset.blockchain',
  'fiatOutput.outputDate',
];

/**
 * `GET /sell/:id/history` — filtered by the sell route and its user.
 *
 * Without it the query loads whole `BuyFiat` rows: 470 columns for these nine values.
 */
export const BUY_FIAT_HISTORY_PROJECTION = new ReadProjection<BuyFiat>(
  'buyFiat',
  [
    ['buyFiat.outputAsset', 'outputAsset'],
    ['buyFiat.cryptoInput', 'cryptoInput'],
    ['cryptoInput.asset', 'cryptoInputAsset'],
    ['buyFiat.fiatOutput', 'fiatOutput'],
    ['buyFiat.sell', 'sell'],
    ['sell.user', 'sellUser'],
  ],
  BUY_FIAT_HISTORY_RESPONSE_FIELDS,
  // Never part of the response: the primary keys that make the ORM materialise the joined rows.
  ['buyFiat.id', 'outputAsset.id', 'cryptoInput.id', 'cryptoInputAsset.id', 'fiatOutput.id'],
);

@Injectable()
export class BuyFiatRepository extends BaseRepository<BuyFiat> {
  constructor(manager: EntityManager) {
    super(BuyFiat, manager);
  }

  /**
   * Transactions on a user's sell route, loaded with the history fields only.
   *
   * `fields` is what the mutation test in `buy-fiat-history.projection.spec.ts` re-runs the query
   * with; `BuyFiatService.getBuyFiatHistory` calls this without it.
   */
  async findSellHistory(
    userId: number,
    routeId?: number,
    fields: ReadonlyArray<string> = BUY_FIAT_HISTORY_PROJECTION.fields,
  ): Promise<BuyFiat[]> {
    const query = BUY_FIAT_HISTORY_PROJECTION.apply(this.createQueryBuilder('buyFiat'), fields).where(
      'sellUser.id = :userId',
      { userId },
    );
    if (routeId != null) query.andWhere('sell.id = :routeId', { routeId });
    return query.getMany();
  }
}
