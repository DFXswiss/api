import { LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerLeg } from '../entities/ledger-leg.entity';
import { LedgerAccountBalanceDto, LedgerLegEntryDto, LedgerPeriodDto, LedgerReconStatus } from './ledger-account.dto';
import {
  AccountReconResultDto,
  LedgerFeedStaleness,
  LedgerReconResultStatus,
  SuspenseLegDto,
} from './ledger-reconciliation.dto';

// aggregated balance of a single account over the requested period (computed in the query service)
export interface AccountBalance {
  account: LedgerAccount;
  balanceNative: number;
  balanceChf: number;
}

// per-account reconciliation result (computed in the query service against the persisted feed, §7)
export interface AccountReconResult {
  account: LedgerAccount;
  ledgerBalance: number;
  externalFeedBalance: number;
  difference: number;
  feedTimestamp?: Date;
  feedAge?: number;
  staleness: LedgerFeedStaleness;
  status: LedgerReconResultStatus;
}

// the recon snapshot a balance row carries into the account list (ASSET accounts only)
export interface AccountReconSnapshot {
  reconStatus: LedgerReconStatus;
  reconDiff?: number;
  lastVerified?: Date;
}

// a suspense leg joined to its tx (for the open-suspense overview)
export interface SuspenseLegRow {
  leg: LedgerLeg;
  bookingDate: Date;
  age: number;
}

export class LedgerDtoMapper {
  static mapPeriod(from: Date, to: Date): LedgerPeriodDto {
    return { from: from.toISOString(), to: to.toISOString() };
  }

  static mapAccountBalance(balance: AccountBalance, recon?: AccountReconSnapshot): LedgerAccountBalanceDto {
    return {
      accountId: balance.account.id,
      name: balance.account.name,
      type: balance.account.type,
      currency: balance.account.currency,
      balanceNative: balance.balanceNative,
      balanceChf: balance.balanceChf,
      reconStatus: recon?.reconStatus,
      reconDiff: recon?.reconDiff,
      lastVerified: recon?.lastVerified?.toISOString(),
    };
  }

  static mapLegEntry(leg: LedgerLeg, bookingDate: Date, valueDate: Date, counter?: LedgerAccount): LedgerLegEntryDto {
    return {
      legId: leg.id,
      txId: leg.txId,
      bookingDate: bookingDate.toISOString(),
      valueDate: valueDate.toISOString(),
      description: leg.tx?.description,
      sourceType: leg.tx?.sourceType,
      sourceId: leg.tx?.sourceId,
      seq: leg.tx?.seq,
      counterAccountId: counter?.id,
      counterAccountName: counter?.name,
      amountNative: leg.amount,
      amountChf: leg.amountChf,
      priceChf: leg.priceChf,
      reversalOf: leg.tx?.reversalOfId,
    };
  }

  static mapReconResult(result: AccountReconResult): AccountReconResultDto {
    return {
      accountId: result.account.id,
      accountName: result.account.name,
      ledgerBalance: result.ledgerBalance,
      externalFeedBalance: result.externalFeedBalance,
      difference: result.difference,
      feedTimestamp: result.feedTimestamp?.toISOString(),
      feedAge: result.feedAge,
      staleness: result.staleness,
      status: result.status,
    };
  }

  static mapSuspenseLeg(row: SuspenseLegRow): SuspenseLegDto {
    const { leg } = row;
    return {
      legId: leg.id,
      txId: leg.txId,
      bookingDate: row.bookingDate.toISOString(),
      description: leg.tx?.description,
      sourceType: leg.tx?.sourceType,
      sourceId: leg.tx?.sourceId,
      amountNative: leg.amount,
      amountChf: leg.amountChf,
      currency: leg.account?.currency,
      age: row.age,
    };
  }
}
