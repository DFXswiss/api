import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  createCustomDeposit,
  createDefaultDeposit,
} from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createDefaultUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { CryptoRoute } from '../crypto-route.entity';

const defaultCryptoRoute: Partial<CryptoRoute> = {
  user: createDefaultUser(),
  deposit: createCustomDeposit({ blockchain: Blockchain.BITCOIN }),
  targetDeposit: createDefaultDeposit(),
  asset: createDefaultAsset(),
  buyCryptos: [],
  cryptoInputs: [],
};

export function createDefaultCryptoRoute(): CryptoRoute {
  return createCustomCryptoRoute({});
}

export function createCustomCryptoRoute(customValues: Partial<CryptoRoute>): CryptoRoute {
  return Object.assign(new CryptoRoute(), { ...defaultCryptoRoute, ...customValues });
}
