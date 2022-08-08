import { createDefaultDeposit } from 'src/payment/models/deposit/__tests__/mock/deposit.entity.mock';
import { createDefaultUser } from 'src/user/models/user/__tests__/mock/user.entity.mock';
import { CryptoRoute } from '../../crypto-route.entity';

const defaultCryptoRoute: Partial<CryptoRoute> = {
  user: createDefaultUser(),
  deposit: createDefaultDeposit(),
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
