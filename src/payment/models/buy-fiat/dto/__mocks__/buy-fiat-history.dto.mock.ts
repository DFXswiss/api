import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { BuyFiatHistoryDto } from '../buy-fiat-history.dto';

const defaultBuyFiatHistory: BuyFiatHistoryDto = {
  inputAmount: 0.0005,
  inputAsset: 'BTC',
  outputAmount: 10,
  outputAsset: 'EUR',
  date: new Date(),
  isComplete: false,
  txId: 'TX_ID_01',
  amlCheck: AmlCheck.PASS,
};

export function createDefaultBuyFiatHistory(): BuyFiatHistoryDto {
  return defaultBuyFiatHistory;
}

export function createCustomBuyFiatHistory(customValues: Partial<BuyFiatHistoryDto>): BuyFiatHistoryDto {
  return { ...defaultBuyFiatHistory, ...customValues };
}
