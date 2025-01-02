import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createDefaultBuy } from 'src/subdomains/core/buy-crypto/routes/buy/__mocks__/buy.entity.mock';
import { createDefaultTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { CheckStatus } from '../../../../aml/enums/check-status.enum';
import { BuyCrypto, BuyCryptoStatus } from '../buy-crypto.entity';
import { createCustomBuyCryptoBatch } from './buy-crypto-batch.entity.mock';
import { createDefaultBuyCryptoFee } from './buy-crypto-fee.entity.mock';

const defaultBuyCrypto: Partial<BuyCrypto> = {
  id: 1,
  buy: createDefaultBuy(),
  batch: createCustomBuyCryptoBatch({ transactions: [] }),
  inputAmount: 100,
  inputAsset: 'EUR',
  inputReferenceAmount: 100,
  inputReferenceAsset: 'EUR',
  amountInChf: 120,
  amountInEur: 100,
  amlCheck: CheckStatus.PASS,
  percentFee: 0.01,
  percentFeeAmount: 1,
  inputReferenceAmountMinusFee: 99,
  outputReferenceAmount: 0.005,
  outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
  outputAmount: 0.2,
  outputAsset: createCustomAsset({ dexName: 'BTC' }),
  txId: 'TX_ID_01',
  outputDate: new Date(),
  mailSendDate: new Date(),
  refProvision: 0,
  refFactor: 0,
  isComplete: false,
  fee: createDefaultBuyCryptoFee(),
  status: BuyCryptoStatus.PENDING_LIQUIDITY,
  transaction: createDefaultTransaction(),
  chargebackAmount: null,
};

export function createDefaultBuyCrypto(): BuyCrypto {
  return createCustomBuyCrypto({});
}

export function createCustomBuyCrypto(customValues: Partial<BuyCrypto>): BuyCrypto {
  return Object.assign(new BuyCrypto(), { ...defaultBuyCrypto, ...customValues });
}
