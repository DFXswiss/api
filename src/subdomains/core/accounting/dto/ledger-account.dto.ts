import { AccountType } from '../entities/ledger-account.entity';

export type LedgerReconStatus = 'ok' | 'diff' | 'stale' | 'unverified' | 'placeholder';

export class LedgerAccountBalanceDto {
  accountId: number;
  name: string;
  type: AccountType;
  currency: string;
  balanceNative: number;
  balanceChf: number;
  reconStatus?: LedgerReconStatus;
  reconDiff?: number;
  lastVerified?: string;
}

export class LedgerPeriodDto {
  from: string;
  to: string;
}

export class LedgerAccountsResponseDto {
  period: LedgerPeriodDto;
  accounts: LedgerAccountBalanceDto[];
}

export class LedgerLegEntryDto {
  legId: number;
  txId: number;
  bookingDate: string;
  valueDate: string;
  description?: string;
  sourceType: string;
  sourceId: string;
  seq: number;
  counterAccountId?: number;
  counterAccountName?: string;
  amountNative: number;
  amountChf?: number;
  priceChf?: number;
  reversalOf?: number;
}

export class LedgerLegsResponseDto {
  accountId: number;
  accountName: string;
  currency: string;
  period: LedgerPeriodDto;
  openingBalance: number;
  closingBalance: number;
  legs: LedgerLegEntryDto[];
  total: number;
}
