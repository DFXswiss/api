export class MarginPeriodDto {
  date: string;
  // feeIncome = Σ INCOME/fee-* + INCOME/trading + Σ INCOME/spread-* (spread-* ALWAYS type=INCOME filtered, Minor R12-4)
  feeIncome: number;
  // executionCosts = Σ EXPENSE/spread-* + EXPENSE/network-fee (+ bank-fee, acquirer-fee) (spread-* ALWAYS type=EXPENSE filtered)
  executionCosts: number;
  // otherOpex = Σ EXPENSE/refReward + Σ EXPENSE/extraordinary (Major R7-2; equity-reconciliation subtracts it too)
  otherOpex: number;
  realizedMargin: number; // feeIncome − executionCosts (operative core metric, §7.6)
  fxPnl: number; // Σ */fx-revaluation
}

export class MarginResponseDto {
  periods: MarginPeriodDto[];
  totalFeeIncome: number;
  totalExecutionCosts: number;
  totalOtherOpex: number;
  totalRealizedMargin: number;
}

export class EquityDecompositionDto {
  // transitPhantom = Σ ledger_leg.amountChf WHERE account.type=TRANSIT (signed) — Class-2 double-count phantom (Minor R13-5)
  transitPhantom: number;
  // staleFeed = Σ ledger_leg.amountChf WHERE sourceType='mark_to_market' on unverified accounts — Class-3 (frozen feed)
  staleFeed: number;
  // spreadFees = Σ EXPENSE/spread-* + EXPENSE/network-fee (+ bank-fee, acquirer-fee) — Class-6 (= executionCosts, type=EXPENSE)
  spreadFees: number;
  // other = difference − (transitPhantom + staleFeed + spreadFees) — the ONLY residual bucket: Class-5
  // (window-straddling residuals + un-auditable trade rests, NOT an unattributed catch-all; Minor R11-5/R13-5)
  other: number;
}

export class EquityComparisonPeriodDto {
  date: string;
  // journalEquity = signed Σ over {ASSET,TRANSIT,LIABILITY,SUSPENSE,ROUNDING} balances (no leading minus, §7.6 Major R8-1) → positive
  journalEquity: number;
  financialDataLogTotal: number; // = totalBalanceChf (log-job.service.ts:120), positive
  difference: number; // journalEquity − financialDataLogTotal
  decomposition?: EquityDecompositionDto;
}

export class EquityComparisonDto {
  periods: EquityComparisonPeriodDto[];
}
