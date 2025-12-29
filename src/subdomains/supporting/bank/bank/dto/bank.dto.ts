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
  OLKY = 'Olkypay',
  MAERKI = 'Maerki Baumann',
  REVOLUT = 'Revolut',
  RAIFFEISEN = 'Raiffeisen',
  YAPEAL = 'Yapeal',
}

export enum CardBankName {
  CHECKOUT = 'Checkout',
}
