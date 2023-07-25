import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { PaymentStatus } from 'src/subdomains/core/history/dto/history.dto';
import { SellHistoryDto } from '../sell-history.dto';

const defaultSellHistory: SellHistoryDto = {
  inputAmount: 0.0005,
  inputAsset: 'BTC',
  outputAmount: 10,
  outputAsset: 'EUR',
  date: new Date(),
  isComplete: false,
  txId: 'TX_ID_01',
  txUrl: `https://defiscan.live/transactions/TX_ID_01`,
  amlCheck: CheckStatus.PASS,
  status: PaymentStatus.PENDING,
};

export function createDefaultSellHistory(): SellHistoryDto {
  return defaultSellHistory;
}

export function createCustomSellHistory(customValues: Partial<SellHistoryDto>): SellHistoryDto {
  return { ...defaultSellHistory, ...customValues };
}
