import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyOrder } from '../entities/custody-order.entity';
import { CustodyOrderStatus } from '../enums/custody';

/** What `CustodyOrderHistoryDtoMapper.map` reads. */
export const CUSTODY_ORDER_HISTORY_RESPONSE_FIELDS = [
  'custodyOrder.type',
  // `mapStatus` translates it together with `type`; both branches of that switch are response state.
  'custodyOrder.status',
  'custodyOrder.created',
  'custodyOrder.completedAt',
  'custodyOrder.inputAmount',
  'custodyOrder.outputAmount',
  'inputAsset.name',
  'outputAsset.name',
  'transactionRequest.estimatedAmount',
  'transactionRequest.amount',
];

/**
 * `GET /custody/order` — a user's order history.
 *
 * The query joined the two assets and the transaction request with `leftJoinAndSelect`, which loads
 * each of them whole: 19 columns for the two names and two amounts the response shows.
 */
export const CUSTODY_ORDER_HISTORY_PROJECTION = new ReadProjection<CustodyOrder>(
  'custodyOrder',
  [
    ['custodyOrder.inputAsset', 'inputAsset'],
    ['custodyOrder.outputAsset', 'outputAsset'],
    ['custodyOrder.transactionRequest', 'transactionRequest'],
  ],
  CUSTODY_ORDER_HISTORY_RESPONSE_FIELDS,
  // Never part of the response: the primary keys that materialise the joined rows, and the id the
  // query orders by to keep pagination deterministic.
  ['custodyOrder.id', 'inputAsset.id', 'outputAsset.id', 'transactionRequest.id'],
);

@Injectable()
export class CustodyOrderRepository extends BaseRepository<CustodyOrder> {
  constructor(manager: EntityManager) {
    super(CustodyOrder, manager);
  }

  /**
   * The custody orders of an account, newest first, capped at a hundred.
   *
   * `fields` is what the mutation test in `custody-order-history.projection.spec.ts` re-runs the
   * query with; `CustodyOrderService.getOrdersByUserData` calls this without it. That method serves
   * two endpoints — `GET /custody/order` and `GET /custody/account/:id/order` — so both answer out
   * of this projection, and the second one is wider only because its access check loads elsewhere.
   */
  async findHistoryFor(
    userDataId: number,
    fields: ReadonlyArray<string> = CUSTODY_ORDER_HISTORY_PROJECTION.fields,
  ): Promise<CustodyOrder[]> {
    return (
      CUSTODY_ORDER_HISTORY_PROJECTION.apply(this.createQueryBuilder('custodyOrder'), fields)
        .innerJoin('custodyOrder.user', 'user')
        .innerJoin('user.userData', 'userData')
        .where('userData.id = :userDataId', { userDataId })
        .andWhere('custodyOrder.status != :createdStatus', { createdStatus: CustodyOrderStatus.CREATED })
        // The list shows completedAt where the order is completed, created otherwise. Sorting by
        // created alone would put rows out of order against the dates the reader can see.
        .orderBy('COALESCE("custodyOrder"."completedAt", "custodyOrder"."created")', 'DESC')
        // Two orders can share a timestamp, and an undefined order among them would let rows swap
        // places between calls - or cross the cap below and vanish. The id keeps it deterministic.
        .addOrderBy('custodyOrder.id', 'DESC')
        // limit, not take: take() splits the query in two and parses the raw orderBy at every dot,
        // which turns the expression above into a lookup for an alias named COALESCE("custodyOrder"
        // and throws on every call. Every relation joined here is to-one, so no row can be
        // duplicated and limiting rows is the same as limiting entities.
        .limit(100)
        .getMany()
    );
  }
}
