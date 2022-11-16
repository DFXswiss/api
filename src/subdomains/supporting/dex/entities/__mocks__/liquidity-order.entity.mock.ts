import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { LiquidityOrder, LiquidityOrderContext, LiquidityOrderType } from '../liquidity-order.entity';

export function createDefaultLiquidityOrder(): LiquidityOrder {
  return createCustomLiquidityOrder({});
}

export function createCustomLiquidityOrder(customValues: Partial<LiquidityOrder>): LiquidityOrder {
  const {
    type,
    context,
    correlationId,
    chain,
    referenceAsset,
    referenceAmount,
    targetAsset,
    targetAmount,
    isReady,
    isComplete,
    swapAsset,
    swapAmount,
    strategy,
    txId,
    purchasedAmount,
  } = customValues;

  const keys = Object.keys(customValues);
  const entity = new LiquidityOrder();

  entity.type = keys.includes('type') ? type : LiquidityOrderType.PURCHASE;
  entity.context = keys.includes('context') ? context : LiquidityOrderContext.BUY_CRYPTO;
  entity.correlationId = keys.includes('correlationId') ? correlationId : 'CID_01';
  entity.chain = keys.includes('chain') ? chain : Blockchain.DEFICHAIN;
  entity.referenceAsset = keys.includes('referenceAsset') ? referenceAsset : createCustomAsset({ dexName: 'BTC' });
  entity.referenceAmount = keys.includes('referenceAmount') ? referenceAmount : 1;
  entity.targetAsset = keys.includes('targetAsset') ? targetAsset : createDefaultAsset();
  entity.targetAmount = keys.includes('targetAmount') ? targetAmount : 2;
  entity.isReady = keys.includes('isReady') ? isReady : false;
  entity.isComplete = keys.includes('isComplete') ? isComplete : false;
  entity.swapAsset = keys.includes('swapAsset') ? swapAsset : createCustomAsset({ dexName: 'DFI' });
  entity.swapAmount = keys.includes('swapAmount') ? swapAmount : 1;
  entity.strategy = keys.includes('strategy') ? strategy : AssetCategory.CRYPTO;
  entity.txId = keys.includes('txId') ? txId : 'PID_01';
  entity.purchasedAmount = keys.includes('purchasedAmount') ? purchasedAmount : 2;

  return entity;
}
