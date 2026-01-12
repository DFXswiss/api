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

export const yapealEUR = createCustomBank({
  name: IbanBankName.YAPEAL,
  currency: 'EUR',
  iban: 'CH1234567890123456789',
  bic: 'YAPECHCHXXX',
  receive: true,
});

export const yapealCHF = createCustomBank({
  name: IbanBankName.YAPEAL,
  currency: 'CHF',
  iban: 'CH9876543210987654321',
  bic: 'YAPECHCHXXX',
  receive: true,
});

export function createDefaultBank(): Bank {
  return createCustomBank({});
}

export function createCustomBank(customValues: Partial<Bank>): Bank {
  return Object.assign(new Bank(), { ...defaultBank, ...customValues });
}

export function createDefaultBanks(): Bank[] {
  return [olkyEUR, yapealEUR, yapealCHF];
}

export function createDefaultDisabledBanks(): Bank[] {
  olkyEUR.receive = false;
  return [olkyEUR, yapealEUR, yapealCHF];
}
