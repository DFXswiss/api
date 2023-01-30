import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { SellHistoryDto } from '../sell-history.dto';

const defaultSellHistory: SellHistoryDto = {
  inputAmount: 0.0005,
  inputAsset: 'BTC',
  outputAmount: 10,
  outputAsset: 'EUR',
  date: new Date(),
  isComplete: false,
  txId: 'TX_ID_01',
  txUrl: 'url/txId',
  amlCheck: AmlCheck.PASS,
};

export function createDefaultSellHistory(): SellHistoryDto {
  return defaultSellHistory;
}

export function createCustomSellHistory(customValues: Partial<SellHistoryDto>): SellHistoryDto {
  return { ...defaultSellHistory, ...customValues };
}
