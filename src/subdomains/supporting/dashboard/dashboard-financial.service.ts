import { Injectable } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RefRewardService } from '../../core/referral/reward/services/ref-reward.service';
import { Log } from '../log/log.entity';
import { LogService } from '../log/log.service';
import { FinanceLog } from '../log/dto/log.dto';
import {
  BalanceByGroupDto,
  FinancialChangesEntryDto,
  FinancialChangesResponseDto,
  FinancialLogEntryDto,
  FinancialLogResponseDto,
  LatestBalanceResponseDto,
  RefRewardRecipientDto,
} from './dto/financial-log.dto';

@Injectable()
export class DashboardFinancialService {
  constructor(
    private readonly logService: LogService,
    private readonly assetService: AssetService,
    private readonly refRewardService: RefRewardService,
  ) {}

  async getFinancialLog(from?: Date, dailySample?: boolean): Promise<FinancialLogResponseDto> {
    const [logs, btcAsset] = await Promise.all([
      this.logService.getFinancialLogs(from, dailySample),
      this.assetService.getBtcCoin(),
    ]);

    const btcAssetId = btcAsset?.id;
    const entries = logs
      .map((log) => this.mapLogToEntry(log, btcAssetId))
      .filter((e): e is FinancialLogEntryDto => e != null);

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
            accrued: changes.minus?.ref?.accrued ?? 0,
            fee: changes.minus?.ref?.fee ?? 0,
          },
          binance: {
            total: changes.minus?.binance?.total ?? 0,
            withdraw: changes.minus?.binance?.withdraw ?? 0,
            trading: changes.minus?.binance?.trading ?? 0,
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

  async getLatestBalance(): Promise<LatestBalanceResponseDto | undefined> {
    const latest = await this.logService.getLatestFinancialLog();
    if (!latest) return undefined;

    let financeLog: FinanceLog;
    try {
      financeLog = JSON.parse(latest.message);
    } catch {
      return undefined;
    }

    // By type (from existing balancesByFinancialType)
    const byType: BalanceByGroupDto[] = [];
    if (financeLog.balancesByFinancialType) {
      for (const [type, data] of Object.entries(financeLog.balancesByFinancialType)) {
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
    if (financeLog.assets) {
      const assetIds = Object.keys(financeLog.assets).map(Number);
      const assets = await this.assetService.getAssetsById(assetIds);
      const assetMap = new Map(assets.map((a) => [a.id, a]));

      for (const [idStr, assetData] of Object.entries(financeLog.assets)) {
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

    return { timestamp: latest.created, byType, byBlockchain };
  }

  private mapLogToEntry(log: Log, btcAssetId?: number): FinancialLogEntryDto | undefined {
    try {
      const financeLog: FinanceLog = JSON.parse(log.message);

      const btcPriceChf = this.extractBtcPrice(financeLog, btcAssetId);

      const balancesByType: Record<string, { plusBalanceChf: number; minusBalanceChf: number }> = {};
      if (financeLog.balancesByFinancialType) {
        for (const [type, data] of Object.entries(financeLog.balancesByFinancialType)) {
          balancesByType[type] = {
            plusBalanceChf: data.plusBalanceChf,
            minusBalanceChf: data.minusBalanceChf,
          };
        }
      }

      return {
        timestamp: log.created,
        totalBalanceChf: financeLog.balancesTotal?.totalBalanceChf ?? 0,
        plusBalanceChf: financeLog.balancesTotal?.plusBalanceChf ?? 0,
        minusBalanceChf: financeLog.balancesTotal?.minusBalanceChf ?? 0,
        btcPriceChf,
        balancesByType,
      };
    } catch {
      return undefined;
    }
  }

  private extractBtcPrice(financeLog: FinanceLog, btcAssetId?: number): number {
    if (!financeLog.assets || !btcAssetId) return 0;

    return financeLog.assets[btcAssetId]?.priceChf ?? 0;
  }
}
