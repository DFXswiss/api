import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutRequest } from '..';
import { PayoutOrderContext } from '../../entities/payout-order.entity';

export function createDefaultPayoutRequest(): PayoutRequest {
  return createCustomPayoutRequest({});
}

export function createCustomPayoutRequest(customValues: Partial<PayoutRequest>): PayoutRequest {
  const { context, correlationId, asset, amount, destinationAddress } = customValues;

  const keys = Object.keys(customValues);
  return {
    context: keys.includes('context') ? context : PayoutOrderContext.BUY_CRYPTO,
    correlationId: keys.includes('correlationId') ? correlationId : 'CID_01',
    asset: keys.includes('asset') ? asset : createDefaultAsset(),
    amount: keys.includes('amount') ? amount : 1,
    destinationAddress: keys.includes('destinationAddress') ? destinationAddress : 'ADDR_01',
  };
}
