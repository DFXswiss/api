import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyOrder } from '../entities/custody-order.entity';

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
}
