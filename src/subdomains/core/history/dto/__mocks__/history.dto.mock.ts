import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { HistoryDtoDeprecated, PaymentStatus } from 'src/subdomains/core/history/dto/history.dto';

const defaultHistory: HistoryDtoDeprecated = {
  inputAmount: 0.0006,
  inputAsset: 'BTC',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: new Date(),
  isComplete: false,
  txId: 'TX_INPUT_ID_01',
  txUrl: 'https://etherscan.io/tx/TX_ID_01',
  amlCheck: CheckStatus.PASS,
  status: PaymentStatus.PENDING,
};

export function createDefaultHistory(): HistoryDtoDeprecated {
  return defaultHistory;
}

export function createCustomHistory(customValues: Partial<HistoryDtoDeprecated>): HistoryDtoDeprecated {
  return { ...defaultHistory, ...customValues };
}
