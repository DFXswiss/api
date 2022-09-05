import { AmlCheck } from 'src/payment/models/buy-crypto/enums/aml-check.enum';
import { createDefaultSell } from 'src/payment/models/sell/__mocks__/sell.entity.mock';
import { createDefaultAsset } from 'src/shared/models/asset/__tests__/mock/asset.entity.mock';
import { CryptoInput, CryptoInputType } from '../crypto-input.entity';

const defaultCryptoInput: Partial<CryptoInput> = {
  inTxId: 'IN_TX_ID_0',
  vout: 1,
  outTxId: 'OUT_TX_ID_0',
  returnTxId: null,
  blockHeight: 42,
  amount: 0.00005,
  btcAmount: 0.00005,
  usdtAmount: 1,
  asset: createDefaultAsset(),
  type: CryptoInputType.BUY_FIAT,
  route: createDefaultSell(),
  isConfirmed: false,
  amlCheck: AmlCheck.PASS,
};

export function createDefaultCryptoInput(): CryptoInput {
  return createCustomCryptoInput({});
}

export function createCustomCryptoInput(customValues: Partial<CryptoInput>): CryptoInput {
  return Object.assign(new CryptoInput(), { ...defaultCryptoInput, ...customValues });
}
