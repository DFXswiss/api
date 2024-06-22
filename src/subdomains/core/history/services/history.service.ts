import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { Readable } from 'stream';
import { TransactionDto } from '../../../supporting/payment/dto/transaction.dto';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { RefRewardService } from '../../referral/reward/ref-reward.service';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
import { CryptoStaking } from '../../staking/entities/crypto-staking.entity';
import { StakingRefReward } from '../../staking/entities/staking-ref-reward.entity';
import { StakingReward } from '../../staking/entities/staking-reward.entity';
import { StakingService } from '../../staking/services/staking.service';
import { ExportFormat, HistoryQueryUser } from '../dto/history-query.dto';
import { ChainReportCsvHistoryDto } from '../dto/output/chain-report-history.dto';
import { CoinTrackingCsvHistoryDto } from '../dto/output/coin-tracking-history.dto';
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
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly buyFiatService: BuyFiatService,
    private readonly stakingService: StakingService,
    private readonly refRewardService: RefRewardService,
    private readonly transactionService: TransactionService,
  ) {}

  async getJsonHistory<T extends ExportType>(query: HistoryQueryUser, exportFormat: T): Promise<HistoryDto<T>[]> {
    return (await this.getHistory(query, exportFormat)) as HistoryDto<T>[];
  }

  async getCsvHistory<T extends ExportType>(query: HistoryQueryUser, exportFormat: T): Promise<StreamableFile> {
    return (await this.getHistory(query, exportFormat)) as StreamableFile;
  }

  async getHistory<T extends ExportType>(
    query: HistoryQueryUser,
    exportType: T,
  ): Promise<HistoryDto<T>[] | StreamableFile> {
    const user = await this.userService.getUserByAddress(query.userAddress);
    if (!user) throw new NotFoundException('User not found');

    const all =
      query.buy == null && query.sell == null && query.staking == null && query.ref == null && query.lm == null;

    const transaction = await this.transactionService.getTransactionsForUser(user.id, query.from, query.to);

    const buyCryptos = (all || query.buy) && transaction.filter((t) => t.buyCrypto).map((t) => t.buyCrypto);
    const buyFiats = (all || query.sell) && transaction.filter((t) => t.buyFiat).map((t) => t.buyFiat);
    const refRewards = (all || query.ref) && transaction.filter((t) => t.refReward).map((t) => t.refReward);
    const stakingRewards =
      query.staking && (await this.stakingService.getUserStakingRewards([user.id], query.from, query.to));
    const stakingInvests = query.staking && (await this.stakingService.getUserInvests(user.id, query.from, query.to));
    const refStakingReward =
      query.staking && (await this.stakingService.getUserStakingRefRewards([user.id], query.from, query.to));

    const txArray: HistoryDto<T>[] = [
      ...(await this.getBuyCryptoTransactions(buyCryptos, exportType)),
      ...(await this.getBuyFiatTransactions(buyFiats, exportType)),
      ...this.getStakingInvests(stakingInvests?.deposits, stakingInvests?.withdrawals, exportType),
      ...this.getStakingRewards(stakingRewards, refStakingReward, exportType),
      ...(await this.getRefRewards(refRewards, exportType)),
    ].reduce((prev, curr) => prev.concat(curr), []);

    return query.format === ExportFormat.CSV ? this.getCsv(txArray, exportType) : txArray;
  }

  getCsv(tx: any[], exportType: ExportType): StreamableFile {
    if (tx.length === 0) throw new NotFoundException('No transactions found');
    return new StreamableFile(
      Readable.from([exportType === ExportType.CHAIN_REPORT ? Util.toCsv(tx, ';', true) : Util.toCsv(tx)]),
    );
  }

  // --- HELPER METHODS --- //

  private async getBuyCryptoTransactions<T>(buyCryptos: BuyCrypto[] = [], exportFormat: T): Promise<HistoryDto<T>[]> {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return Util.sort(
          this.fixDuplicateTxCT([
            ...CoinTrackingHistoryDtoMapper.mapBuyCryptoFiatTransactions(buyCryptos),
            ...CoinTrackingHistoryDtoMapper.mapBuyCryptoCryptoTransactions(buyCryptos),
          ]),
          'date',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return Util.sort(
          this.fixDuplicateTxCR([
            ...ChainReportHistoryDtoMapper.mapBuyCryptoFiatTransactions(buyCryptos),
            ...ChainReportHistoryDtoMapper.mapBuyCryptoCryptoTransactions(buyCryptos),
          ]),
          'timestamp',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.COMPACT:
        const extended = await Util.asyncMap(buyCryptos, (b) => this.buyCryptoWebhookService.extendBuyCrypto(b));
        return Util.sort(TransactionDtoMapper.mapBuyCryptoTransactions(extended), 'date', 'DESC') as HistoryDto<T>[];
    }
  }

  private async getBuyFiatTransactions<T>(buyFiats: BuyFiat[] = [], exportFormat: T): Promise<HistoryDto<T>[]> {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return Util.sort(
          this.fixDuplicateTxCT(CoinTrackingHistoryDtoMapper.mapBuyFiatTransactions(buyFiats)),
          'date',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return Util.sort(
          this.fixDuplicateTxCR(ChainReportHistoryDtoMapper.mapBuyFiatTransactions(buyFiats)),
          'timestamp',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.COMPACT:
        const extended = await Util.asyncMap(buyFiats, (b) => this.buyFiatService.extendBuyFiat(b));
        return Util.sort(TransactionDtoMapper.mapBuyFiatTransactions(extended), 'date', 'DESC') as HistoryDto<T>[];
    }
  }

  private getStakingInvests<T>(
    deposits: CryptoStaking[] = [],
    withdrawals: CryptoStaking[] = [],
    exportFormat: T,
  ): HistoryDto<T>[] {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return Util.sort(
          this.fixDuplicateTxCT([
            ...CoinTrackingHistoryDtoMapper.mapStakingDeposits(deposits),
            ...CoinTrackingHistoryDtoMapper.mapStakingWithdrawals(withdrawals),
          ]),
          'date',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return Util.sort(
          this.fixDuplicateTxCR([
            ...ChainReportHistoryDtoMapper.mapStakingDeposits(deposits),
            ...ChainReportHistoryDtoMapper.mapStakingWithdrawals(withdrawals),
          ]),
          'timestamp',
          'DESC',
        ) as HistoryDto<T>[];

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
        return Util.sort(
          this.fixDuplicateTxCT([
            ...CoinTrackingHistoryDtoMapper.mapStakingRewards(stakingRewards),
            ...CoinTrackingHistoryDtoMapper.mapStakingRefRewards(stakingRefRewards),
          ]),
          'date',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return Util.sort(
          this.fixDuplicateTxCR([
            ...ChainReportHistoryDtoMapper.mapStakingRewards(stakingRewards),
            ...ChainReportHistoryDtoMapper.mapStakingRefRewards(stakingRefRewards),
          ]),
          'timestamp',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.COMPACT:
        return [];
    }
  }

  private async getRefRewards<T>(refRewards: RefReward[] = [], exportFormat: T): Promise<HistoryDto<T>[]> {
    switch (exportFormat) {
      case ExportType.COIN_TRACKING:
        return Util.sort(
          this.fixDuplicateTxCT(CoinTrackingHistoryDtoMapper.mapRefRewards(refRewards)),
          'date',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.CHAIN_REPORT:
        return Util.sort(
          this.fixDuplicateTxCR(ChainReportHistoryDtoMapper.mapRefRewards(refRewards)),
          'timestamp',
          'DESC',
        ) as HistoryDto<T>[];

      case ExportType.COMPACT:
        const extended = await Util.asyncMap(refRewards, (r) => this.refRewardService.extendReward(r));
        return Util.sort(TransactionDtoMapper.mapReferralRewards(extended), 'date', 'DESC') as HistoryDto<T>[];
    }
  }

  private fixDuplicateTxCT(history: CoinTrackingCsvHistoryDto[]): CoinTrackingCsvHistoryDto[] {
    Array.from(Util.groupBy(history, 'txid'))
      .map(([_, tx]) => tx)
      .filter((r) => r.length > 1)
      .forEach((tx) => tx.forEach((r, i) => (r.txid += i > 0 ? i : '')));

    return history;
  }

  private fixDuplicateTxCR(history: ChainReportCsvHistoryDto[]): ChainReportCsvHistoryDto[] {
    Array.from(Util.groupBy(history, 'txid'))
      .map(([_, tx]) => tx)
      .filter((r) => r.length > 1)
      .forEach((tx) => tx.forEach((r, i) => (r.txid += i > 0 ? i : '')));

    return history;
  }
}
