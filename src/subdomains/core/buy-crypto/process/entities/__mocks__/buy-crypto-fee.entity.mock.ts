import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { BuyCryptoFee } from '../buy-crypto-fees.entity';
import { BuyCrypto } from '../buy-crypto.entity';

export function createDefaultBuyCryptoFee(): BuyCryptoFee {
  return createCustomBuyCryptoFee({});
}

export function createCustomBuyCryptoFee(customValues: Partial<BuyCryptoFee>): BuyCryptoFee {
  const {
    id,
    buyCrypto,
    feeReferenceAsset,
    estimatePurchaseFeeAmount,
    estimatePurchaseFeePercent,
    estimatePayoutFeeAmount,
    estimatePayoutFeePercent,
    actualPurchaseFeeAmount,
    actualPurchaseFeePercent,
    actualPayoutFeeAmount,
    actualPayoutFeePercent,
    allowedTotalFeeAmount,
  } = customValues;
  const keys = Object.keys(customValues);

  const entity = new BuyCryptoFee();

  entity.id = keys.includes('id') ? id : 1;
  // default to object literal to avoid circular creation
  entity.buyCrypto = keys.includes('buyCrypto') ? buyCrypto : ({ id: 'ID_01' } as unknown as BuyCrypto);
  entity.feeReferenceAsset = keys.includes('feeReferenceAsset')
    ? feeReferenceAsset
    : createCustomAsset({ dexName: 'BTC' });
  entity.estimatePurchaseFeeAmount = keys.includes('estimatePurchaseFeeAmount') ? estimatePurchaseFeeAmount : 2;
  entity.estimatePurchaseFeePercent = keys.includes('estimatePurchaseFeePercent') ? estimatePurchaseFeePercent : 0.001;
  entity.estimatePayoutFeeAmount = keys.includes('estimatePayoutFeeAmount') ? estimatePayoutFeeAmount : 0.0001;
  entity.estimatePayoutFeePercent = keys.includes('estimatePayoutFeePercent') ? estimatePayoutFeePercent : 0.000001;
  entity.actualPurchaseFeeAmount = keys.includes('actualPurchaseFeeAmount') ? actualPurchaseFeeAmount : 2;
  entity.actualPurchaseFeePercent = keys.includes('actualPurchaseFeePercent') ? actualPurchaseFeePercent : 0.001;
  entity.actualPayoutFeeAmount = keys.includes('actualPayoutFeeAmount') ? actualPayoutFeeAmount : 1;
  entity.actualPayoutFeePercent = keys.includes('actualPayoutFeePercent') ? actualPayoutFeePercent : 0.001;
  entity.allowedTotalFeeAmount = keys.includes('allowedTotalFeeAmount') ? allowedTotalFeeAmount : 0.01;

  return entity;
}
