import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../payout-order.entity';

export function createDefaultPayoutOrder(): PayoutOrder {
  return createCustomPayoutOrder({});
}

export function createCustomPayoutOrder(customValues: Partial<PayoutOrder>): PayoutOrder {
  const { id, context, correlationId, chain, asset, amount, destinationAddress, status, transferTxId, payoutTxId } =
    customValues;

  const keys = Object.keys(customValues);
  const entity = new PayoutOrder();

  entity.id = keys.includes('id') ? id : 1;
  entity.context = keys.includes('context') ? context : PayoutOrderContext.BUY_CRYPTO;
  entity.correlationId = keys.includes('correlationId') ? correlationId : 'CID_01';
  entity.chain = keys.includes('chain') ? chain : Blockchain.DEFICHAIN;
  entity.asset = keys.includes('asset') ? asset : createDefaultAsset();
  entity.amount = keys.includes('amount') ? amount : 1;
  entity.destinationAddress = keys.includes('destinationAddress') ? destinationAddress : 'ADDR_01';
  entity.status = keys.includes('status') ? status : PayoutOrderStatus.CREATED;
  entity.transferTxId = keys.includes('transferTxId') ? transferTxId : 'TTX_01';
  entity.payoutTxId = keys.includes('payoutTxId') ? payoutTxId : 'PTX_01';

  return entity;
}
