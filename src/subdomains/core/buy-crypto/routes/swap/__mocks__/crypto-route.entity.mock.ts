import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createDefaultUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import {
  createCustomDeposit,
  createDefaultDeposit,
} from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { Swap } from '../swap.entity';

const defaultCryptoRoute: Partial<Swap> = {
  user: createDefaultUser(),
  deposit: createCustomDeposit({ blockchains: `${Blockchain.BITCOIN}` }),
  targetDeposit: createDefaultDeposit(),
  asset: createDefaultAsset(),
  buyCryptos: [],
  cryptoInputs: [],
};

export function createDefaultCryptoRoute(): Swap {
  return createCustomCryptoRoute({});
}

export function createCustomCryptoRoute(customValues: Partial<Swap>): Swap {
  return Object.assign(new Swap(), { ...defaultCryptoRoute, ...customValues });
}
