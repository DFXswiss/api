import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Deposit } from '../deposit.entity';

const defaultDeposit: Partial<Deposit> = {
  address: 'someAddress',
  blockchains: `${Blockchain.BITCOIN}`,
};

export function createDefaultDeposit(): Deposit {
  return createCustomDeposit({});
}

export function createCustomDeposit(customValues: Partial<Deposit>): Deposit {
  return Object.assign(new Deposit(), { ...defaultDeposit, ...customValues });
}
