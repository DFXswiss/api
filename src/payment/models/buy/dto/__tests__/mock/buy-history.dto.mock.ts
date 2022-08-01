import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { BuyHistoryDto } from '../../buy-history.dto';

const defaultBuyHistory: BuyHistoryDto = {
  inputAmount: 10,
  inputAsset: 'EUR',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: 'date',
  isComplete: true,
  txId: 'someTxId',
  amlCheck: AmlCheck.PASS,
};

export function createDefaultBuyHistory(): BuyHistoryDto {
  return defaultBuyHistory;
}

export function createCustomBuyHistory(customValues: Partial<BuyHistoryDto>): BuyHistoryDto {
  return { ...defaultBuyHistory, ...customValues };
}
