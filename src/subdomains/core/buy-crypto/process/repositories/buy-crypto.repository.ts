import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, UpdateResult } from 'typeorm';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';

/**
 * The ten values `BuyCryptoHistoryMapper.toDto` reads.
 *
 * Both history endpoints share them; only the route they filter by differs, which is what the two
 * projections below encode.
 */
export const BUY_CRYPTO_HISTORY_RESPONSE_FIELDS = [
  'buyCrypto.inputAmount',
  'buyCrypto.inputAsset',
  'buyCrypto.amlCheck',
  'buyCrypto.outputAmount',
  'buyCrypto.txId',
  'buyCrypto.isComplete',
  'buyCrypto.outputDate',
  'buyCrypto.status',
  'outputAsset.dexName',
  'outputAsset.blockchain',
];

// Never part of the response: the primary keys that make the ORM materialise the joined rows.
const HISTORY_GUARDS = ['buyCrypto.id', 'outputAsset.id'];

/**
 * `GET /buy/:id/history` — filtered by the buy route and its user.
 *
 * Without it the query loads whole `BuyCrypto` rows: 497 columns for these ten values.
 */
export const BUY_CRYPTO_BUY_HISTORY_PROJECTION = new ReadProjection<BuyCrypto>(
  'buyCrypto',
  [
    ['buyCrypto.outputAsset', 'outputAsset'],
    ['buyCrypto.buy', 'buy'],
    ['buy.user', 'buyUser'],
  ],
  BUY_CRYPTO_HISTORY_RESPONSE_FIELDS,
  HISTORY_GUARDS,
);

/** `GET /swap/:id/history` — the same response, filtered by the swap route instead. 509 columns before. */
export const BUY_CRYPTO_ROUTE_HISTORY_PROJECTION = new ReadProjection<BuyCrypto>(
  'buyCrypto',
  [
    ['buyCrypto.outputAsset', 'outputAsset'],
    ['buyCrypto.cryptoRoute', 'cryptoRoute'],
    ['cryptoRoute.user', 'routeUser'],
  ],
  BUY_CRYPTO_HISTORY_RESPONSE_FIELDS,
  HISTORY_GUARDS,
);

@Injectable()
export class BuyCryptoRepository extends BaseRepository<BuyCrypto> {
  constructor(manager: EntityManager) {
    super(BuyCrypto, manager);
  }

  /**
   * Transactions on a user's buy route, loaded with the history fields only.
   *
   * `routeId` narrows to a single route; without it the caller gets every buy route they own, which
   * is what `GET /history` relies on. `fields` is what the mutation test in
   * `buy-crypto-history.projection.spec.ts` re-runs the query with; `BuyCryptoService` calls this
   * without it.
   */
  async findBuyHistory(
    userId: number,
    routeId?: number,
    fields: ReadonlyArray<string> = BUY_CRYPTO_BUY_HISTORY_PROJECTION.fields,
  ): Promise<BuyCrypto[]> {
    const query = BUY_CRYPTO_BUY_HISTORY_PROJECTION.apply(this.createQueryBuilder('buyCrypto'), fields).where(
      'buyUser.id = :userId',
      { userId },
    );
    if (routeId != null) query.andWhere('buy.id = :routeId', { routeId });
    return query.getMany();
  }

  /** The same for a swap route. */
  async findSwapHistory(
    userId: number,
    routeId?: number,
    fields: ReadonlyArray<string> = BUY_CRYPTO_ROUTE_HISTORY_PROJECTION.fields,
  ): Promise<BuyCrypto[]> {
    const query = BUY_CRYPTO_ROUTE_HISTORY_PROJECTION.apply(this.createQueryBuilder('buyCrypto'), fields).where(
      'routeUser.id = :userId',
      { userId },
    );
    if (routeId != null) query.andWhere('cryptoRoute.id = :routeId', { routeId });
    return query.getMany();
  }

  async updateFee(id: number, update: Partial<BuyCryptoFee>): Promise<UpdateResult> {
    return this.manager.update(BuyCryptoFee, id, update);
  }

  async saveFee(fee: BuyCryptoFee): Promise<BuyCryptoFee> {
    return this.manager.save(BuyCryptoFee, fee);
  }

  async deleteFee(fee: BuyCryptoFee): Promise<void> {
    await this.manager.remove(BuyCryptoFee, fee);
  }
}
