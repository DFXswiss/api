import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { BuyCryptoBatch, BuyCryptoBatchStatus } from '../buy-crypto-batch.entity';

const defaultBatch: Partial<BuyCryptoBatch> = {
  id: 1,
  transactions: [],
  outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
  outputReferenceAmount: 2,
  outputAsset: createCustomAsset({ dexName: 'dTSLA' }),
  outputAmount: 1,
  status: BuyCryptoBatchStatus.CREATED,
  blockchain: Blockchain.BITCOIN,
};

export function createDefaultBuyCryptoBatch(): BuyCryptoBatch {
  return createCustomBuyCryptoBatch({});
}

export function createCustomBuyCryptoBatch(customValues: Partial<BuyCryptoBatch>): BuyCryptoBatch {
  return Object.assign(new BuyCryptoBatch(), { ...defaultBatch, ...customValues });
}
