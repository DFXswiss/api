import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TypeBreakdownDto {
  @ApiProperty({ description: 'Transaction type (e.g., BuyCrypto, BuyFiat)' })
  type: string;

  @ApiProperty({ description: 'Total amount for this type' })
  amount: number;

  @ApiProperty({ description: 'Number of transactions' })
  count: number;
}

export class DetailedBalanceSheetDto {
  @ApiProperty({ description: 'Bank name' })
  bankName: string;

  @ApiProperty({ description: 'Currency (CHF, EUR, etc.)' })
  currency: string;

  @ApiProperty({ description: 'IBAN' })
  iban: string;

  @ApiProperty({ description: 'Year' })
  year: number;

  @ApiProperty({ description: 'Opening balance (from DB or 0)' })
  openingBalance: number;

  @ApiProperty({ description: 'Income breakdown by type', type: [TypeBreakdownDto] })
  incomeByType: TypeBreakdownDto[];

  @ApiProperty({ description: 'Expenses breakdown by type', type: [TypeBreakdownDto] })
  expensesByType: TypeBreakdownDto[];

  @ApiProperty({ description: 'Total income (CRDT transactions)' })
  totalIncome: number;

  @ApiProperty({ description: 'Total expenses (DBIT transactions)' })
  totalExpenses: number;

  @ApiProperty({ description: 'Calculated closing balance (opening + income - expenses)' })
  calculatedClosingBalance: number;

  @ApiPropertyOptional({ description: 'Defined closing balance from DB (if exists)' })
  definedClosingBalance?: number;

  @ApiProperty({ description: 'Whether calculated matches defined closing balance' })
  balanceMatches: boolean;

  @ApiProperty({ description: 'Whether defined closing balance exists in DB' })
  hasDefinedClosingBalance: boolean;
}

export class BankBalanceSheetDto {
  @ApiProperty({ description: 'Bank name' })
  bankName: string;

  @ApiProperty({ description: 'Currency (CHF, EUR, etc.)' })
  currency: string;

  @ApiProperty({ description: 'IBAN' })
  iban: string;

  @ApiProperty({ description: 'Year' })
  year: number;

  @ApiProperty({ description: 'Opening balance (from DB or 0)' })
  openingBalance: number;

  @ApiProperty({ description: 'Total income (CRDT transactions)' })
  totalIncome: number;

  @ApiProperty({ description: 'Total expenses (DBIT transactions)' })
  totalExpenses: number;

  @ApiProperty({ description: 'Calculated closing balance (opening + income - expenses)' })
  calculatedClosingBalance: number;

  @ApiPropertyOptional({ description: 'Defined closing balance from DB (if exists)' })
  definedClosingBalance?: number;

  @ApiProperty({ description: 'Whether calculated matches defined closing balance' })
  balanceMatches: boolean;

  @ApiProperty({ description: 'Whether defined closing balance exists in DB' })
  hasDefinedClosingBalance: boolean;
}
