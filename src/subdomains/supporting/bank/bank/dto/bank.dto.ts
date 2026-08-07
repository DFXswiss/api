import { ApiProperty } from '@nestjs/swagger';

export class BankDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  iban: string;

  @ApiProperty()
  bic: string;

  @ApiProperty()
  currency: string;
}

export enum IbanBankName {
  FRICK = 'Bank Frick',
  OLKY = 'Olkypay',
  MAERKI = 'Maerki Baumann',
  RAIFFEISEN = 'Raiffeisen',
  YAPEAL = 'Yapeal',
}

// Product decision: the currencies Bank Frick serves for both personal-IBAN issuance and deposit
// routing. Single source of truth - do not duplicate this list elsewhere. Frozen because the same
// reference backs both the deposit routing and the issuance gate: an in-place mutation would
// silently change both at runtime.
export const FRICK_CURRENCIES: readonly string[] = Object.freeze(['EUR', 'CHF']);

export enum CardBankName {
  CHECKOUT = 'Checkout',
}
