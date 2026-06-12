export type LedgerFeedStaleness = 'fresh' | 'stale' | 'missing' | 'placeholder';
export type LedgerReconResultStatus = 'ok' | 'diff' | 'stale' | 'unverified' | 'suspense_alarm';

export class AccountReconResultDto {
  accountId: number;
  accountName: string;
  ledgerBalance: number;
  externalFeedBalance: number;
  difference: number;
  feedTimestamp?: string;
  feedAge?: number;
  staleness: LedgerFeedStaleness;
  status: LedgerReconResultStatus;
}

export class ReconStatusResponseDto {
  runAt: string;
  accounts: AccountReconResultDto[];
}

export class SuspenseLegDto {
  legId: number;
  txId: number;
  bookingDate: string;
  description?: string;
  sourceType: string;
  sourceId: string;
  amountNative: number;
  amountChf?: number;
  currency: string;
  age: number;
}

export class SuspenseResponseDto {
  totalChf: number;
  legs: SuspenseLegDto[];
}
