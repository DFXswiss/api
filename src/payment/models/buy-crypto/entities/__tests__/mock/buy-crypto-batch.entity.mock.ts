import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../../buy-crypto-batch.entity';
import { createDefaultBuyCrypto } from './buy-crypto.entity.mock';

export function createDefaultBuyCryptoBatch(): BuyCryptoBatch {
  return createCustomBuyCryptoBatch({});
}

export function createCustomBuyCryptoBatch(customValues: Partial<BuyCryptoBatch>): BuyCryptoBatch {
  const { id, transactions, outputReferenceAsset, outputReferenceAmount, outputAsset, outputAmount, status, outTxId } =
    customValues;
  const keys = Object.keys(customValues);

  const entity = new BuyCryptoBatch();

  entity.id = keys.includes('id') ? id : 1;
  entity.transactions = keys.includes('transactions') ? transactions : [createDefaultBuyCrypto()];
  entity.outputReferenceAsset = keys.includes('outputReferenceAsset') ? outputReferenceAsset : '';
  entity.outputReferenceAmount = keys.includes('outputReferenceAmount') ? outputReferenceAmount : 2;
  entity.outputAsset = keys.includes('outputAsset') ? outputAsset : 'dTSLA';
  entity.outputAmount = keys.includes('outputAmount') ? outputAmount : 1;
  entity.status = keys.includes('status') ? status : BuyCryptoBatchStatus.CREATED;
  entity.outTxId = keys.includes('outTxId') ? outTxId : '';

  return entity;
}
