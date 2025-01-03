import { PaymentStatus } from 'src/subdomains/core/history/dto/history.dto';
import { CheckStatus } from '../../../../../aml/enums/check-status.enum';
import { BuyHistoryDto } from '../buy-history.dto';

const defaultBuyHistory: BuyHistoryDto = {
  inputAmount: 10,
  inputAsset: 'EUR',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: new Date(),
  isComplete: false,
  txId: 'TX_ID_01',
  txUrl: 'https://etherscan.io/tx/TX_ID_01',
  amlCheck: CheckStatus.PASS,
  status: PaymentStatus.PENDING,
};

export function createDefaultBuyHistory(): BuyHistoryDto {
  return defaultBuyHistory;
}

export function createCustomBuyHistory(customValues: Partial<BuyHistoryDto>): BuyHistoryDto {
  return { ...defaultBuyHistory, ...customValues };
}
