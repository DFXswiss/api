import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { CryptoInputHistoryDto } from '../../crypto-input-history.dto';

const defaultCryptoInputHistory: CryptoInputHistoryDto = {
  inputAmount: 0.0006,
  inputAsset: 'BTC',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: new Date(),
  isComplete: false,
  txId: 'TX_INPUT_ID_01',
  amlCheck: AmlCheck.PASS,
};

export function createDefaultCryptoInputHistory(): CryptoInputHistoryDto {
  return defaultCryptoInputHistory;
}

export function createCustomCryptoInputHistory(customValues: Partial<CryptoInputHistoryDto>): CryptoInputHistoryDto {
  return { ...defaultCryptoInputHistory, ...customValues };
}
