import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { CryptoRouteHistoryDto } from '../../crypto-route-history.dto';

const defaultCryptoRouteHistory: CryptoRouteHistoryDto = {
  inputAmount: 0.0006,
  inputAsset: 'BTC',
  outputAmount: 0.0005,
  outputAsset: 'BTC',
  date: new Date(),
  isComplete: false,
  txId: 'TX_INPUT_ID_01',
  amlCheck: AmlCheck.PASS,
};

export function createDefaultCryptoRouteHistory(): CryptoRouteHistoryDto {
  return defaultCryptoRouteHistory;
}

export function createCustomCryptoRouteHistory(customValues: Partial<CryptoRouteHistoryDto>): CryptoRouteHistoryDto {
  return { ...defaultCryptoRouteHistory, ...customValues };
}
