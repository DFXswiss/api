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
  REVOLUT = 'Revolut',
  KALEIDO = 'Kaleido',
  RAIFFEISEN = 'Raiffeisen',
}

export enum CardBankName {
  CHECKOUT = 'Checkout',
}
