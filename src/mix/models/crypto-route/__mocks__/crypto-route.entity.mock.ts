import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomDeposit, createDefaultDeposit } from 'src/mix/models/deposit/__mocks__/deposit.entity.mock';
import { createDefaultUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { CryptoRoute } from '../crypto-route.entity';

const defaultCryptoRoute: Partial<CryptoRoute> = {
  user: createDefaultUser(),
  deposit: createCustomDeposit({ blockchain: Blockchain.BITCOIN }),
  targetDeposit: createDefaultDeposit(),
  buyCryptos: [],
  cryptoInputs: [],
};

export function createDefaultCryptoRoute(): CryptoRoute {
  return createCustomCryptoRoute({});
}

export function createCustomCryptoRoute(customValues: Partial<CryptoRoute>): CryptoRoute {
  return Object.assign(new CryptoRoute(), { ...defaultCryptoRoute, ...customValues });
}
