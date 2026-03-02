export class FinancialLogEntryDto {
  timestamp: Date;
  totalBalanceChf: number;
  plusBalanceChf: number;
  minusBalanceChf: number;
  btcPriceChf: number;
  balancesByType: Record<string, { plusBalanceChf: number; minusBalanceChf: number }>;
}

export class FinancialLogResponseDto {
  entries: FinancialLogEntryDto[];
}
