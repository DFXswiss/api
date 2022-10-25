import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../buy-crypto-batch.entity';
import { createDefaultBuyCrypto } from './buy-crypto.entity.mock';

export function createDefaultBuyCryptoBatch(): BuyCryptoBatch {
  return createCustomBuyCryptoBatch({});
}

export function createCustomBuyCryptoBatch(customValues: Partial<BuyCryptoBatch>): BuyCryptoBatch {
  const {
    id,
    transactions,
    outputReferenceAsset,
    outputReferenceAmount,
    outputAsset,
    outputAmount,
    status,
    blockchain,
  } = customValues;
  const keys = Object.keys(customValues);

  const entity = new BuyCryptoBatch();

  entity.id = keys.includes('id') ? id : 1;
  entity.transactions = keys.includes('transactions') ? transactions : [createDefaultBuyCrypto()];
  entity.outputReferenceAsset = keys.includes('outputReferenceAsset')
    ? outputReferenceAsset
    : createCustomAsset({ dexName: 'BTC' });
  entity.outputReferenceAmount = keys.includes('outputReferenceAmount') ? outputReferenceAmount : 2;
  entity.outputAsset = keys.includes('outputAsset') ? outputAsset : createCustomAsset({ dexName: 'dTSLA' });
  entity.outputAmount = keys.includes('outputAmount') ? outputAmount : 1;
  entity.status = keys.includes('status') ? status : BuyCryptoBatchStatus.CREATED;
  entity.blockchain = keys.includes('blockchain') ? blockchain : Blockchain.DEFICHAIN;

  return entity;
}
