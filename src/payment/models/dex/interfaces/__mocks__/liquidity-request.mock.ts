import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { LiquidityRequest } from '..';
import { LiquidityOrderContext } from '../../entities/liquidity-order.entity';

export function createDefaultLiquidityRequest(): LiquidityRequest {
  return createCustomLiquidityRequest({});
}

export function createCustomLiquidityRequest(customValues: Partial<LiquidityRequest>): LiquidityRequest {
  const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = customValues;

  const keys = Object.keys(customValues);
  return {
    context: keys.includes('context') ? context : LiquidityOrderContext.BUY_CRYPTO,
    correlationId: keys.includes('correlationId') ? correlationId : 'CID_01',
    referenceAsset: keys.includes('referenceAsset') ? referenceAsset : 'BTC',
    referenceAmount: keys.includes('referenceAmount') ? referenceAmount : 1,
    targetAsset: keys.includes('targetAsset') ? targetAsset : createDefaultAsset(),
  };
}
