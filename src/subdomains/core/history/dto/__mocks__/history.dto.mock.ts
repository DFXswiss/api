import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { HistoryDto, PaymentStatus } from 'src/subdomains/core/history/dto/history.dto';

const defaultHistory: HistoryDto = {
  inputAmount: 0.0006,
  inputAsset: 'BTC',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: new Date(),
  isComplete: false,
  txId: 'TX_INPUT_ID_01',
  txUrl: 'https://defiscan.live/transactions/TX_ID_01',
  amlCheck: CheckStatus.PASS,
  status: PaymentStatus.PENDING,
};

export function createDefaultHistory(): HistoryDto {
  return defaultHistory;
}

export function createCustomHistory(customValues: Partial<HistoryDto>): HistoryDto {
  return { ...defaultHistory, ...customValues };
}
