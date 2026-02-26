import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface YearlyBalance {
  opening: number;
  closing: number;
}

export class BankDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  iban: string;

  @ApiProperty()
  bic: string;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional({ description: 'Yearly balances per year' })
  yearlyBalances?: Record<string, YearlyBalance>;
}

export enum IbanBankName {
  OLKY = 'Olkypay',
  MAERKI = 'Maerki Baumann',
  RAIFFEISEN = 'Raiffeisen',
  YAPEAL = 'Yapeal',
}

export enum CardBankName {
  CHECKOUT = 'Checkout',
}
