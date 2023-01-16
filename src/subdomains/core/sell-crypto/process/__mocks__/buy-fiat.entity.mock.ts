import { createDefaultCryptoInput } from 'src/mix/models/crypto-input/__mocks__/crypto-input.entity.mock';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { createDefaultSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { createDefaultBankTx } from 'src/subdomains/supporting/bank/bank-tx/__mocks__/bank-tx.entity.mock';
import { BuyFiat } from '../buy-fiat.entity';

const defaultBuyFiat: Partial<BuyFiat> = {
  cryptoInput: createDefaultCryptoInput(),
  sell: createDefaultSell(),
  bankTx: createDefaultBankTx(),
  recipientMail: '',
  mail1SendDate: new Date(),
  mail2SendDate: null,
  mail3SendDate: null,
  inputAmount: 0.00005,
  inputAsset: 'BTC',
  inputReferenceAmount: 0.00005,
  inputReferenceAsset: 'BTC',
  amountInChf: 0.97,
  amountInEur: 1,
  amlCheck: AmlCheck.PASS,
  amlReason: null,
  percentFee: 0.01,
  percentFeeAmount: 1,
  absoluteFeeAmount: null,
  inputReferenceAmountMinusFee: 0.99,
  cryptoReturnTxId: null,
  cryptoReturnDate: null,
  mailReturnSendDate: null,
  outputReferenceAmount: 1,
  outputReferenceAsset: 'EUR',
  outputAmount: 1,
  outputAsset: 'EUR',
  remittanceInfo: null,
  instantSepa: null,
  usedBank: null,
  bankBatchId: null,
  bankStartTimestamp: null,
  bankFinishTimestamp: null,
  info: null,
  outputDate: new Date(),
  isComplete: false,
};

export function createDefaultBuyFiat(): BuyFiat {
  return createCustomBuyFiat({});
}

export function createCustomBuyFiat(customValues: Partial<BuyFiat>): BuyFiat {
  return Object.assign(new BuyFiat(), { ...defaultBuyFiat, ...customValues });
}
