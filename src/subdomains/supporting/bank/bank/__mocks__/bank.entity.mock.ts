import { Bank } from '../bank.entity';
import { IbanBankName } from '../dto/bank.dto';

const defaultBank: Partial<Bank> = {
  iban: 'AT00 0000 0000 0000 0000',
  name: IbanBankName.FRICK,
  bic: 'ABCDE',
  currency: 'EUR',
  receive: true,
  send: true,
};

export const frickEUR = createCustomBank({
  name: IbanBankName.FRICK,
  currency: 'EUR',
  iban: 'LI95088110104693K000E',
  bic: 'BFRILI22',
  receive: true,
});

export const frickCHF = createCustomBank({
  name: IbanBankName.FRICK,
  currency: 'CHF',
  iban: 'LI52088110104693K000C',
  bic: 'BFRILI22',
  receive: true,
});

export const frickUSD = createCustomBank({
  name: IbanBankName.FRICK,
  currency: 'USD',
  iban: 'LI51088110104693K000U',
  bic: 'BFRILI22',
  receive: true,
});

export const olkyEUR = createCustomBank({
  name: IbanBankName.OLKY,
  currency: 'EUR',
  iban: 'LU116060002000005040',
  bic: 'OLKILUL1',
  receive: true,
  sctInst: true,
});

export const maerkiEUR = createCustomBank({
  name: IbanBankName.MAERKI,
  currency: 'EUR',
  iban: 'CH6808573177975201814',
  bic: 'MAEBCHZZ',
  receive: true,
});

export const maerkiCHF = createCustomBank({
  name: IbanBankName.MAERKI,
  currency: 'CHF',
  iban: 'CH3408573177975200001',
  bic: 'MAEBCHZZ',
  receive: true,
});

export function createDefaultBank(): Bank {
  return createCustomBank({});
}

export function createCustomBank(customValues: Partial<Bank>): Bank {
  return Object.assign(new Bank(), { ...defaultBank, ...customValues });
}

export function createDefaultBanks(): Bank[] {
  return [frickEUR, frickCHF, frickUSD, olkyEUR, maerkiEUR, maerkiCHF];
}

export function createDefaultDisabledBanks(): Bank[] {
  olkyEUR.receive = false;
  return [frickEUR, frickCHF, frickUSD, olkyEUR, maerkiEUR, maerkiCHF];
}
