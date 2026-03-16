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

export class FinancialChangesEntryDto {
  timestamp: Date;
  total: number;
  plus: {
    total: number;
    buyCrypto: number;
    buyFiat: number;
    paymentLink: number;
    trading: number;
  };
  minus: {
    total: number;
    ref: { total: number; amount: number; fee: number };
    binance: { total: number; withdraw: number; trading: number };
    blockchain: { total: number; txIn: number; txOut: number; trading: number };
  };
}

export class FinancialChangesResponseDto {
  entries: FinancialChangesEntryDto[];
}

export class BalanceByGroupDto {
  name: string;
  plusBalanceChf: number;
  minusBalanceChf: number;
  netBalanceChf: number;
  assets?: Record<string, number>;
}

export class RefRewardRecipientDto {
  userDataId: number;
  count: number;
  totalChf: number;
}

export class LatestBalanceResponseDto {
  timestamp: Date;
  byType: BalanceByGroupDto[];
  byBlockchain: BalanceByGroupDto[];
}
