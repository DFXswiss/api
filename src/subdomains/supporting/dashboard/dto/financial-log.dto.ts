export class FinancialLogEntryDto {
  timestamp: Date;
  totalBalanceChf: number;
  btcPriceChf: number;
  /**
   * Present only when the caller did not opt out via the `byType` query parameter on
   * GET /v1/dashboard/financial/log (`byType=false`); omitted entirely (not 0, not null) for the
   * Overview screen that calls this endpoint on every refresh, since that screen only charts
   * totalBalanceChf/btcPriceChf — same reasoning and same opt-out flag as balancesByType below.
   * This is a deliberate API contract change: the frontend type for the Overview screen's
   * response needs a matching update (separate PR).
   */
  plusBalanceChf?: number;
  /** Same includeByType-gated presence as plusBalanceChf. */
  minusBalanceChf?: number;
  /** Same includeByType-gated presence as plusBalanceChf. */
  fxPnlChf?: number;
  /**
   * plusBalanceChf/minusBalanceChf can be missing per type when the source FinancialDataLog
   * snapshot omitted one of the two keys (see FinancialLogSummary.balancesByType); a missing
   * value is left out of the JSON response the same way it always was, never defaulted to 0.
   *
   * The whole field is only present when the caller did not opt out via the `byType` query
   * parameter on GET /v1/dashboard/financial/log (`byType=false`); when opted out it is omitted
   * entirely from the response — never an empty object, never null — because it makes up 82% of
   * the payload and the Overview screen that calls this endpoint on every refresh never reads it.
   */
  balancesByType?: Record<string, { plusBalanceChf?: number; minusBalanceChf?: number }>;
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
    bank: number;
    kraken: { total: number; withdraw: number; trading: number };
    ref: { total: number; amount: number; fee: number };
    binance: { total: number; withdraw: number; trading: number };
    scrypt: { total: number; withdraw: number; trading: number };
    mexc: { total: number; withdraw: number; trading: number };
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
