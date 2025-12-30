import { Bank } from '../bank.entity';
import { IbanBankName } from '../dto/bank.dto';

const defaultBank: Partial<Bank> = {
  iban: 'AT00 0000 0000 0000 0000',
  name: IbanBankName.OLKY,
  bic: 'ABCDE',
  currency: 'EUR',
  receive: true,
  send: true,
};

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
  return [olkyEUR, maerkiEUR, maerkiCHF];
}

export function createDefaultDisabledBanks(): Bank[] {
  olkyEUR.receive = false;
  return [olkyEUR, maerkiEUR, maerkiCHF];
}
