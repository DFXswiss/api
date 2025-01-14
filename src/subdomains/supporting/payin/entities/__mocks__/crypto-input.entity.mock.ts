import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createDefaultSell } from 'src/subdomains/core/sell-crypto/route/__mocks__/sell.entity.mock';
import { CryptoInput } from '../crypto-input.entity';

const defaultCryptoInput: Partial<CryptoInput> = {
  inTxId: 'IN_TX_ID_0',
  txSequence: 1,
  outTxId: 'OUT_TX_ID_0',
  returnTxId: null,
  blockHeight: 42,
  amount: 0.1,
  asset: createDefaultAsset(),
  route: createDefaultSell(),
  isConfirmed: false,
};

export function createDefaultCryptoInput(): CryptoInput {
  return createCustomCryptoInput({});
}

export function createCustomCryptoInput(customValues: Partial<CryptoInput>): CryptoInput {
  return Object.assign(new CryptoInput(), { ...defaultCryptoInput, ...customValues });
}
