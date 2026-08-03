import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { RefRewardService } from '../../core/referral/reward/services/ref-reward.service';
import { AssetLog, BalancesByFinancialType, FinanceLog } from '../log/dto/log.dto';
import { Log } from '../log/log.entity';
import { FinancialLogSummary } from '../log/log.repository';
import { LogService } from '../log/log.service';
import {
  BalanceByGroupDto,
  FinancialChangesEntryDto,
  FinancialChangesResponseDto,
  FinancialLogEntryDto,
  FinancialLogResponseDto,
  LatestBalanceResponseDto,
  RefRewardRecipientDto,
} from './dto/financial-log.dto';
import { LatestBalanceStore } from './latest-balance.store';

@Injectable()
export class DashboardFinancialService {
  constructor(
    private readonly logService: LogService,
    private readonly assetService: AssetService,
    private readonly refRewardService: RefRewardService,
    private readonly latestBalanceStore: LatestBalanceStore,
  ) {}

  async getFinancialLog(from?: Date, dailySample?: boolean, includeByType?: boolean): Promise<FinancialLogResponseDto> {
    // BTC price is projected in SQL and needs btcAssetId as a parameter, so resolve getBtcCoin first.
    // One extra sequential roundtrip vs the previous Promise.all, judged negligible against the
    // eliminated transfer volume of the full message JSON.
    const btcAsset = await this.assetService.getBtcCoin();
    const summaries = await this.logService.getFinancialLogSummaries(
      btcAsset?.id,
      from,
      dailySample,
      undefined,
      undefined,
      undefined,
      includeByType,
    );

    const entries = summaries.map((summary) => this.mapSummaryToEntry(summary));
    return { entries };
  }

  async getRefRewardRecipients(from?: Date): Promise<RefRewardRecipientDto[]> {
    return this.refRewardService.getRewardRecipients(from);
  }

  async getLatestFinancialChanges(): Promise<FinancialChangesEntryDto | undefined> {
    const latest = await this.logService.getLatestFinancialChangesLog();
    if (!latest) return undefined;
    return this.mapChangesLogToEntry(latest);
  }

  async getFinancialChanges(from?: Date, dailySample?: boolean): Promise<FinancialChangesResponseDto> {
    const logs = await this.logService.getFinancialChangesLogs(from, dailySample);

    const entries = logs
      .map((log) => this.mapChangesLogToEntry(log))
      .filter((e): e is FinancialChangesEntryDto => e != null);

    return { entries };
  }

  private mapChangesLogToEntry(log: Log): FinancialChangesEntryDto | undefined {
    try {
      const data = JSON.parse(log.message);
      const changes = data.changes;

      return {
        timestamp: log.created,
        total: changes.total ?? 0,
        plus: {
          total: changes.plus?.total ?? 0,
          buyCrypto: changes.plus?.buyCrypto ?? 0,
          buyFiat: changes.plus?.buyFiat ?? 0,
          paymentLink: changes.plus?.paymentLink ?? 0,
          trading: changes.plus?.trading ?? 0,
        },
        minus: {
          total: changes.minus?.total ?? 0,
          bank: changes.minus?.bank ?? 0,
          kraken: {
            total: changes.minus?.kraken?.total ?? 0,
            withdraw: changes.minus?.kraken?.withdraw ?? 0,
            trading: changes.minus?.kraken?.trading ?? 0,
          },
          ref: {
            total: changes.minus?.ref?.total ?? 0,
            amount: changes.minus?.ref?.amount ?? 0,
            fee: changes.minus?.ref?.fee ?? 0,
          },
          binance: {
            total: changes.minus?.binance?.total ?? 0,
            withdraw: changes.minus?.binance?.withdraw ?? 0,
            trading: changes.minus?.binance?.trading ?? 0,
          },
          scrypt: {
            total: changes.minus?.scrypt?.total ?? 0,
            withdraw: changes.minus?.scrypt?.withdraw ?? 0,
            trading: changes.minus?.scrypt?.trading ?? 0,
          },
          mexc: {
            total: changes.minus?.mexc?.total ?? 0,
            withdraw: changes.minus?.mexc?.withdraw ?? 0,
            trading: changes.minus?.mexc?.trading ?? 0,
          },
          blockchain: {
            total: changes.minus?.blockchain?.total ?? 0,
            txIn: changes.minus?.blockchain?.tx?.in ?? 0,
            txOut: changes.minus?.blockchain?.tx?.out ?? 0,
            trading: changes.minus?.blockchain?.trading ?? 0,
          },
        },
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Answers from LatestBalanceStore, which loads through `loadLatestBalance` when it has no entry
   * or the one it holds has aged out. The load is what makes this correct in a process that never
   * runs the refresh below - see the store for why there is such a process.
   */
  async getLatestBalance(): Promise<LatestBalanceResponseDto | undefined> {
    return this.latestBalanceStore.get(() => this.loadLatestBalance());
  }

  /**
   * Keeps the entry in LatestBalanceStore warm, so that GET /v1/dashboard/financial/latest finds a
   * current value in this process instead of loading one itself.
   *
   * Scope Api, because the store it fills is a field of this service and its reader is the endpoint
   * above. It only reads: LogJobService writes the entry, this parses it and aggregates - once a
   * minute, outside any request. Refresh only, never the sole filler: the job is leased, so in a
   * deployment with several API processes it runs in one of them per tick, and the request path is
   * what fills the rest.
   *
   * Every minute rather than the 15 minutes CONTRIBUTING prefers, because that is the interval
   * LogJobService already writes the underlying entry at (TRADING_LOG, EVERY_MINUTE). A longer
   * one here would not save a write, it would only serve a staler value than the data allows.
   */
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.API, process: Process.LATEST_BALANCE_CACHE })
  async refreshLatestBalance(): Promise<void> {
    await this.latestBalanceStore.refresh(() => this.loadLatestBalance());
  }

  /**
   * Builds the response from the most recent FinancialDataLog entry. `undefined` when there is no
   * entry at all, which is the honest answer for a database that has never had one.
   */
  private async loadLatestBalance(): Promise<LatestBalanceResponseDto | undefined> {
    const latest = await this.logService.getLatestFinancialLog();
    if (!latest) return undefined;

    let financeLog: FinanceLog;
    try {
      financeLog = JSON.parse(latest.message);
    } catch (e) {
      // Raised rather than returned as `undefined`: the store keeps the aggregate it has, so one
      // malformed entry does not replace a good value with nothing. The refresh job reports it.
      throw new Error(`Failed to parse the latest financial log (id ${latest.id})`, { cause: e });
    }

    const assets = financeLog.assets
      ? await this.assetService.getAssetsById(Object.keys(financeLog.assets).map(Number))
      : [];

    return this.buildLatestBalance(latest.created, financeLog.assets, financeLog.balancesByFinancialType, assets);
  }

  private buildLatestBalance(
    timestamp: Date,
    assetLog: AssetLog,
    balancesByFinancialType: BalancesByFinancialType,
    assets: Asset[],
  ): LatestBalanceResponseDto {
    // By type (from existing balancesByFinancialType)
    const byType: BalanceByGroupDto[] = [];
    if (balancesByFinancialType) {
      for (const [type, data] of Object.entries(balancesByFinancialType)) {
        byType.push({
          name: type,
          plusBalanceChf: data.plusBalanceChf,
          minusBalanceChf: data.minusBalanceChf,
          netBalanceChf: data.plusBalanceChf - data.minusBalanceChf,
        });
      }
    }
    byType.sort((a, b) => b.netBalanceChf - a.netBalanceChf);

    // By blockchain (aggregate assets)
    const blockchainTotals: Record<string, { plus: number; assets: Record<string, number> }> = {};
    if (assetLog) {
      const assetMap = new Map(assets.map((a) => [a.id, a]));

      for (const [idStr, assetData] of Object.entries(assetLog)) {
        const asset = assetMap.get(Number(idStr));
        const blockchain = asset?.blockchain ?? 'Unknown';
        const assetName = asset?.name ?? 'Unknown';

        if ((blockchain as string) === 'Scrypt') {
          const spotTotal =
            (assetData.plusBalance?.liquidity?.total ?? 0) + (assetData.plusBalance?.custom?.total ?? 0);
          const pendingTotal = assetData.plusBalance?.pending?.total ?? 0;
          const spotChf = spotTotal * assetData.priceChf;
          const pendingChf = pendingTotal * assetData.priceChf;

          if (spotChf > 0) {
            if (!blockchainTotals['Scrypt Spot']) blockchainTotals['Scrypt Spot'] = { plus: 0, assets: {} };
            blockchainTotals['Scrypt Spot'].plus += spotChf;
            blockchainTotals['Scrypt Spot'].assets[assetName] =
              (blockchainTotals['Scrypt Spot'].assets[assetName] ?? 0) + Math.round(spotChf);
          }
          if (pendingChf > 0) {
            if (!blockchainTotals['Scrypt Pending']) blockchainTotals['Scrypt Pending'] = { plus: 0, assets: {} };
            blockchainTotals['Scrypt Pending'].plus += pendingChf;
            blockchainTotals['Scrypt Pending'].assets[assetName] =
              (blockchainTotals['Scrypt Pending'].assets[assetName] ?? 0) + Math.round(pendingChf);
          }
        } else {
          const plusChf = (assetData.plusBalance?.total ?? 0) * assetData.priceChf;

          if (!blockchainTotals[blockchain]) blockchainTotals[blockchain] = { plus: 0, assets: {} };
          blockchainTotals[blockchain].plus += plusChf;
          blockchainTotals[blockchain].assets[assetName] =
            (blockchainTotals[blockchain].assets[assetName] ?? 0) + Math.round(plusChf);
        }
      }
    }

    const THRESHOLD = 5000;
    let otherTotal = 0;
    const otherAssets: Record<string, number> = {};
    const byBlockchain: BalanceByGroupDto[] = [];

    for (const [name, { plus, assets: assetBreakdown }] of Object.entries(blockchainTotals)) {
      const rounded = Math.round(plus);
      if (rounded <= 0) continue;
      if (rounded < THRESHOLD) {
        otherTotal += rounded;
        for (const [a, v] of Object.entries(assetBreakdown)) {
          otherAssets[a] = (otherAssets[a] ?? 0) + v;
        }
      } else {
        // Filter out small assets within a blockchain
        const filteredAssets: Record<string, number> = {};
        let assetOther = 0;
        for (const [a, v] of Object.entries(assetBreakdown)) {
          if (v >= THRESHOLD) filteredAssets[a] = v;
          else assetOther += v;
        }
        if (assetOther > 0) filteredAssets['Other'] = assetOther;

        byBlockchain.push({
          name,
          plusBalanceChf: rounded,
          minusBalanceChf: 0,
          netBalanceChf: rounded,
          assets: filteredAssets,
        });
      }
    }

    byBlockchain.sort((a, b) => b.netBalanceChf - a.netBalanceChf);

    if (otherTotal > 0) {
      const filteredOtherAssets: Record<string, number> = {};
      let otherAssetOther = 0;
      for (const [a, v] of Object.entries(otherAssets)) {
        if (v >= THRESHOLD) filteredOtherAssets[a] = v;
        else otherAssetOther += v;
      }
      if (otherAssetOther > 0) filteredOtherAssets['Other'] = otherAssetOther;
      byBlockchain.push({
        name: 'Other',
        plusBalanceChf: otherTotal,
        minusBalanceChf: 0,
        netBalanceChf: otherTotal,
        assets: filteredOtherAssets,
      });
    }

    return { timestamp, byType, byBlockchain };
  }

  // Pure mapping over the SQL projection. For the History path (includeByType=true) the response
  // matches the previous mapLogToEntry path exactly, including the `?? 0` field defaults, with two
  // intentional differences from that old path: (1) a `balancesByFinancialType` entry with the value
  // `null` (e.g. `{"Crypto": null}`) now keeps the row (with an empty balancesByType entry) instead of
  // the old per-row try/catch dropping the whole log line — favouring a visible gap over a silently
  // dropped row; and (2) a wrongly-typed `balancesByFinancialType` property (string, boolean, `null`)
  // — previously passed through unchanged, breaking the `number | undefined` DTO contract — now
  // becomes `undefined` (see the `asNumber` guard in log.repository.ts), honouring that contract
  // rather than avoiding a dropped row. The same visible-gap reasoning as (1) covers a top-level
  // `message: null` (not a sub-field, the whole document): the old path threw on the following
  // property access and dropped the row, the new one keeps it as a zero point via the SQL projection
  // and the `?? 0` defaults below — not seen in current production data. A malformed `message`
  // document is a deliberate change from the old per-row silent drop to failing loud for the whole
  // query (the `message::jsonb` cast throws in SQL); individual scalar fields are only nulled via
  // `jsonb_typeof` guards.
  //
  // Chart-only path (includeByType=false): the repository omits plusBalanceChf/minusBalanceChf/
  // fxPnlChf/balancesByType entirely from the summary. The conditional spreads below then omit them
  // from the response as well (not 0, not null) — deliberate API contract change for the Overview
  // screen, which only charts totalBalanceChf/btcPriceChf.
  private mapSummaryToEntry(summary: FinancialLogSummary): FinancialLogEntryDto {
    return {
      timestamp: summary.created,
      totalBalanceChf: summary.totalBalanceChf ?? 0,
      btcPriceChf: summary.btcPriceChf,
      ...(summary.plusBalanceChf !== undefined ? { plusBalanceChf: summary.plusBalanceChf ?? 0 } : {}),
      ...(summary.minusBalanceChf !== undefined ? { minusBalanceChf: summary.minusBalanceChf ?? 0 } : {}),
      ...(summary.fxPnlChf !== undefined ? { fxPnlChf: summary.fxPnlChf ?? 0 } : {}),
      ...(summary.balancesByType !== undefined ? { balancesByType: summary.balancesByType } : {}),
    };
  }
}
