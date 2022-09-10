import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { CryptoHistoryDto } from '../crypto-history.dto';

const defaultCryptoHistory: CryptoHistoryDto = {
  inputAmount: 0.0006,
  inputAsset: 'BTC',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: new Date(),
  isComplete: false,
  txId: 'TX_INPUT_ID_01',
  amlCheck: AmlCheck.PASS,
};

export function createDefaultCryptoHistory(): CryptoHistoryDto {
  return defaultCryptoHistory;
}

export function createCustomCryptoHistory(customValues: Partial<CryptoHistoryDto>): CryptoHistoryDto {
  return { ...defaultCryptoHistory, ...customValues };
}
