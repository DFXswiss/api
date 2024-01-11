import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Readable } from 'stream';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from '../../buy-crypto/process/services/buy-crypto.service';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { RefRewardService } from '../../referral/reward/ref-reward.service';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from '../../sell-crypto/process/buy-fiat.service';
import { CryptoStaking } from '../../staking/entities/crypto-staking.entity';
import { StakingRefReward } from '../../staking/entities/staking-ref-reward.entity';
import { StakingReward } from '../../staking/entities/staking-reward.entity';
import { StakingService } from '../../staking/services/staking.service';
import { ExportFormat, HistoryQueryUser } from '../dto/history-query.dto';
import { ChainReportCsvHistoryDto } from '../dto/output/chain-report-history.dto';
import { CoinTrackingCsvHistoryDto } from '../dto/output/coin-tracking-history.dto';
import { TransactionDto } from '../dto/output/transaction.dto';
import { ChainReportHistoryDtoMapper } from '../mappers/chain-report-history-dto.mapper';
import { CoinTrackingHistoryDtoMapper } from '../mappers/coin-tracking-history-dto.mapper';
import { TransactionDtoMapper } from '../mappers/transaction-dto.mapper';

export type HistoryDto<T> = T extends ExportType.COMPACT
  ? TransactionDto
  : T extends ExportType.COIN_TRACKING
  ? CoinTrackingCsvHistoryDto
  : ChainReportCsvHistoryDto;

export enum ExportType {
  COMPACT = 'Compact',
  COIN_TRACKING = 'CoinTracking',
  CHAIN_REPORT = 'ChainReport',
}

@Injectable()
export class HistoryService {
  constructor(
    private readonly userService: UserService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly stakingService: StakingService,
    private readonly refRewardService: RefRewardService,
  ) {}

  async getJsonHistory<T extends ExportType>(query: HistoryQueryUser, exportFormat: T): Promise<HistoryDto<T>[]> {
    return (await this.getHistory(query, exportFormat)) as HistoryDto<T>[];
  }

  async getCsvHistory<T extends ExportType>(query: HistoryQueryUser, exportFormat: T): Promise<StreamableFile> {
    return (await this.getHistory(query, exportFormat)) as StreamableFile;
  }

  async getHistory<T extends ExportType>(
    query: HistoryQueryUser,
    exportFormat: T,
  ): Promise<HistoryDto<T>[] | StreamableFile> {
    const user = await this.userService.getUserByAddress(query.userAddress);
    if (!user) throw new NotFoundException('User not found');

    const all =
      query.buy == null && query.sell == null && query.staking == null && query.ref == null && query.lm == null;

    const buyCryptos =
      (all || query.buy) && (await this.buyCryptoService.getUserTransactions(user.id, query.from, query.to));
    const buyFiats =
      (all || query.sell) && (await this.buyFiatService.getUserTransactions(user.id, query.from, query.to));
    const stakingRewards =
      query.staking && (await this.stakingService.getUserStakingRewards([user.id], query.from, query.to));
    const stakingInvests = query.staking && (await this.stakingService.getUserInvests(user.id, query.from, query.to));
    const refRewards =
      (all || query.ref) && (await this.refRewardService.getUserRewards([user.id], query.from, query.to));
    const refStakingReward =
      query.staking && (await this.stakingService.getUserStakingRefRewards([user.id], query.from, query.to));

    const txArray: HistoryDto<T>[] = [
      ...this.getBuyCryptoTransactions(buyCryptos, exportFormat),
      ...this.getBuyFiatTransactions(buyFiats, exportFormat),
      ...this.getStakingInvests(stakingInvests?.deposits, stakingInvests?.withdrawals, exportFormat),
      ...this.getStakingRewards(stakingRewards, refStakingReward, exportFormat),
      ...this.getRefRewards(refRewards, exportFormat),
    ].reduce((prev, curr) => prev.concat(curr), []);

    return query.format === ExportFormat.CSV ? this.getHistoryCsv(txArray, exportFormat) : txArray;
  }

  // --- HELPER METHODS --- //
  private getHistoryCsv<T>(tx: HistoryDto<T>[], exportType: ExportType): StreamableFile {
    if (tx.length === 0) throw new NotFoundException('No transactions found');
    return new StreamableFile(
      Readable.from([exportType === ExportType.CHAIN_REPORT ? this.toCsv(tx, ';', true) : this.toCsv(tx)]),
    );
  }

  private toCsv(list: any[], separator = ',', toGermanLocalDateString = false): string {
    const headers = Object.keys(list[0]).join(separator);
    const values = list.map((t) =>
      Object.values(t)
        .map((v) =>
          v instanceof Date
            ? toGermanLocalDateString
              ? v.toLocaleString('de-DE', { timeZone: 'CET' })
              : v.toISOString()
            : v,
        )
        .join(separator),
    );
    return [headers].concat(values).join('\n');
  }

  private getBuyCryptoTransactions<T>(buyCryptos: BuyCrypto[] = [], exportFormat: T): HistoryDto<T>[] {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return this.fixDuplicateTxCT([
          ...CoinTrackingHistoryDtoMapper.mapBuyCryptoFiatTransactions(buyCryptos),
          ...CoinTrackingHistoryDtoMapper.mapBuyCryptoCryptoTransactions(buyCryptos),
        ]).sort((tx1, tx2) => tx2.date.getTime() - tx1.date.getTime()) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return this.fixDuplicateTxCR([
          ...ChainReportHistoryDtoMapper.mapBuyCryptoFiatTransactions(buyCryptos),
          ...ChainReportHistoryDtoMapper.mapBuyCryptoCryptoTransactions(buyCryptos),
        ]).sort((tx1, tx2) => tx2.timestamp.getTime() - tx1.timestamp.getTime()) as HistoryDto<T>[];

      case ExportType.COMPACT:
        return TransactionDtoMapper.mapBuyCryptoTransactions(buyCryptos).sort(
          (tx1, tx2) => tx2.date.getTime() - tx1.date.getTime(),
        ) as HistoryDto<T>[];
    }
  }

  private getBuyFiatTransactions<T>(buyFiats: BuyFiat[] = [], exportFormat: T): HistoryDto<T>[] {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return this.fixDuplicateTxCT(CoinTrackingHistoryDtoMapper.mapBuyFiatTransactions(buyFiats)).sort(
          (tx1, tx2) => tx2.date.getTime() - tx1.date.getTime(),
        ) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return this.fixDuplicateTxCR(ChainReportHistoryDtoMapper.mapBuyFiatTransactions(buyFiats)).sort(
          (tx1, tx2) => tx2.timestamp.getTime() - tx1.timestamp.getTime(),
        ) as HistoryDto<T>[];

      case ExportType.COMPACT:
        return TransactionDtoMapper.mapBuyFiatTransactions(buyFiats).sort(
          (tx1, tx2) => tx2.date.getTime() - tx1.date.getTime(),
        ) as HistoryDto<T>[];
    }
  }

  private getStakingInvests<T>(
    deposits: CryptoStaking[] = [],
    withdrawals: CryptoStaking[] = [],
    exportFormat: T,
  ): HistoryDto<T>[] {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return this.fixDuplicateTxCT([
          ...CoinTrackingHistoryDtoMapper.mapStakingDeposits(deposits),
          ...CoinTrackingHistoryDtoMapper.mapStakingWithdrawals(withdrawals),
        ]).sort((tx1, tx2) => tx2.date.getTime() - tx1.date.getTime()) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return this.fixDuplicateTxCR([
          ...ChainReportHistoryDtoMapper.mapStakingDeposits(deposits),
          ...ChainReportHistoryDtoMapper.mapStakingWithdrawals(withdrawals),
        ]).sort((tx1, tx2) => tx2.timestamp.getTime() - tx1.timestamp.getTime()) as HistoryDto<T>[];

      case ExportType.COMPACT:
        return [];
    }
  }

  private getStakingRewards<T>(
    stakingRewards: StakingReward[] = [],
    stakingRefRewards: StakingRefReward[] = [],
    exportFormat: T,
  ): HistoryDto<T>[] {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return this.fixDuplicateTxCT([
          ...CoinTrackingHistoryDtoMapper.mapStakingRewards(stakingRewards),
          ...CoinTrackingHistoryDtoMapper.mapStakingRefRewards(stakingRefRewards),
        ]).sort((tx1, tx2) => tx2.date.getTime() - tx1.date.getTime()) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return this.fixDuplicateTxCR([
          ...ChainReportHistoryDtoMapper.mapStakingRewards(stakingRewards),
          ...ChainReportHistoryDtoMapper.mapStakingRefRewards(stakingRefRewards),
        ]).sort((tx1, tx2) => tx2.timestamp.getTime() - tx1.timestamp.getTime()) as HistoryDto<T>[];

      case ExportType.COMPACT:
        return [];
    }
  }

  private getRefRewards<T>(refRewards: RefReward[] = [], exportFormat: T): HistoryDto<T>[] {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return this.fixDuplicateTxCT(CoinTrackingHistoryDtoMapper.mapRefRewards(refRewards)).sort(
          (tx1, tx2) => tx2.date.getTime() - tx1.date.getTime(),
        ) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return this.fixDuplicateTxCR(ChainReportHistoryDtoMapper.mapRefRewards(refRewards)).sort(
          (tx1, tx2) => tx2.timestamp.getTime() - tx1.timestamp.getTime(),
        ) as HistoryDto<T>[];

      case ExportType.COMPACT:
        return TransactionDtoMapper.mapReferralRewards(refRewards).sort(
          (tx1, tx2) => tx2.date.getTime() - tx1.date.getTime(),
        ) as HistoryDto<T>[];
    }
  }

  private fixDuplicateTxCT(history: CoinTrackingCsvHistoryDto[]): CoinTrackingCsvHistoryDto[] {
    Array.from(Util.groupBy(history, 'txId'))
      .map(([_, tx]) => tx)
      .filter((r) => r.length > 1)
      .forEach((tx) => tx.forEach((r, i) => (r.txId += i > 0 ? i : '')));

    return history;
  }

  private fixDuplicateTxCR(history: ChainReportCsvHistoryDto[]): ChainReportCsvHistoryDto[] {
    Array.from(Util.groupBy(history, 'txId'))
      .map(([_, tx]) => tx)
      .filter((r) => r.length > 1)
      .forEach((tx) => tx.forEach((r, i) => (r.txId += i > 0 ? i : '')));

    return history;
  }
}
