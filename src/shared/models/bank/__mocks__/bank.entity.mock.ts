import { Bank, BankName } from '../bank.entity';

const defaultBank: Partial<Bank> = {
  iban: 'AT00 0000 0000 0000 0000',
  name: BankName.FRICK,
  bic: 'ABCDE',
  currency: 'EUR',
  receive: true,
  send: true,
};

export function createDefaultBank(): Bank {
  return createCustomBank({});
}

export function createCustomBank(customValues: Partial<Bank>): Bank {
  return Object.assign(new Bank(), { ...defaultBank, ...customValues });
}

export function createDefaultBanks(): Bank[] {
  return [
    createCustomBank({
      name: BankName.FRICK,
      currency: 'EUR',
      iban: 'LI95088110104693K000E',
      bic: 'BFRILI22',
      receive: true,
    }),
    createCustomBank({
      name: BankName.FRICK,
      currency: 'CHF',
      iban: 'LI52088110104693K000C',
      bic: 'BFRILI22',
      receive: true,
    }),
    createCustomBank({
      name: BankName.FRICK,
      currency: 'USD',
      iban: 'LI51088110104693K000U',
      bic: 'BFRILI22',
      receive: true,
    }),
    createCustomBank({
      name: BankName.OLKY,
      currency: 'EUR',
      iban: 'LU116060002000005040',
      bic: 'OLKILUL1',
      receive: true,
    }),
    createCustomBank({
      name: BankName.MAERKI,
      currency: 'EUR',
      iban: 'CH6808573177975201814',
      bic: 'MAEBCHZZ',
      receive: true,
    }),
    createCustomBank({
      name: BankName.MAERKI,
      currency: 'CHF',
      iban: 'CH3408573177975200001',
      bic: 'MAEBCHZZ',
      receive: true,
    }),
  ];
}
