import { createDefaultSell } from 'src/subdomains/core/sell-crypto/sell/__mocks__/sell.entity.mock';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { CryptoInput, CryptoInputType } from '../crypto-input.entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';

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
