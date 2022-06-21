import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../../buy-crypto-batch.entity';

export function createDefaultBuyCryptoBatch(): BuyCryptoBatch {
  return createCustomBuyCryptoBatch({});
}

export function createCustomBuyCryptoBatch(customValues: Partial<BuyCryptoBatch>): BuyCryptoBatch {
  const {
    transactions,
    outputReferenceAsset,
    outputReferenceAmount,
    outputAsset,
    outputAmount,
    status,
    outTxId,
    purchaseTxId,
    lastCompleteBlock,
  } = customValues;
  const keys = Object.keys(customValues);

  const entity = new BuyCryptoBatch();

  entity.transactions = keys.includes('transactions') ? transactions : [];
  entity.outputReferenceAsset = keys.includes('outputReferenceAsset') ? outputReferenceAsset : '';
  entity.outputReferenceAmount = keys.includes('outputReferenceAmount') ? outputReferenceAmount : 2;
  entity.outputAsset = keys.includes('outputAsset') ? outputAsset : 'dTSLA';
  entity.outputAmount = keys.includes('outputAmount') ? outputAmount : 1;
  entity.status = keys.includes('status') ? status : BuyCryptoBatchStatus.CREATED;
  entity.outTxId = keys.includes('outTxId') ? outTxId : '';
  entity.purchaseTxId = keys.includes('purchaseTxId') ? purchaseTxId : '';
  entity.lastCompleteBlock = keys.includes('lastCompleteBlock') ? lastCompleteBlock : 100;

  return entity;
}
