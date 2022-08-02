import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { BuyCryptoHistoryDto } from '../../buy-crypto-history.dto';

const defaultBuyHistory: BuyCryptoHistoryDto = {
  inputAmount: 10,
  inputAsset: 'EUR',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: new Date(),
  isComplete: false,
  txId: 'TX_ID_01',
  amlCheck: AmlCheck.PASS,
};

export function createDefaultBuyCryptoHistory(): BuyCryptoHistoryDto {
  return defaultBuyHistory;
}

export function createCustomBuyCryptoHistory(customValues: Partial<BuyCryptoHistoryDto>): BuyCryptoHistoryDto {
  return { ...defaultBuyHistory, ...customValues };
}
