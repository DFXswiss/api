import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { Readable } from 'stream';
import { TransactionDto } from '../../../supporting/payment/dto/transaction.dto';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { RefRewardService } from '../../referral/reward/services/ref-reward.service';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
import { CryptoStaking } from '../../staking/entities/crypto-staking.entity';
import { StakingRefReward } from '../../staking/entities/staking-ref-reward.entity';
import { StakingReward } from '../../staking/entities/staking-reward.entity';
import { StakingService } from '../../staking/services/staking.service';
import { ExportFormat, HistoryQuery, HistoryQueryUser } from '../dto/history-query.dto';
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

  async getJsonHistory<T extends ExportType>(
    user: User | UserData,
    query: HistoryQuery,
    exportType: T,
  ): Promise<HistoryDto<T>[]> {
    return (await this.getHistoryInternal(user, query, exportType)) as HistoryDto<T>[];
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

    return this.getHistoryInternal(user, query, exportType);
  }

  async getHistoryInternal<T extends ExportType>(
    user: User | UserData,
    query: HistoryQuery,
    exportType: T,
  ): Promise<HistoryDto<T>[] | StreamableFile> {
    const all =
      query.buy == null && query.sell == null && query.staking == null && query.ref == null && query.lm == null;

    const transactions =
      user instanceof UserData
        ? await this.transactionService.getTransactionsForAccount(user.id, query.from, query.to)
        : await this.transactionService.getTransactionsForUser(user.id, query.from, query.to);

    const buyCryptos = all || query.buy ? transactions.filter((t) => t.buyCrypto).map((t) => t.buyCrypto) : [];
    const buyFiats = all || query.sell ? transactions.filter((t) => t.buyFiat).map((t) => t.buyFiat) : [];
    const refRewards = all || query.ref ? transactions.filter((t) => t.refReward).map((t) => t.refReward) : [];

    const staking = query.staking ? await this.getStakingTransactions(user, query, exportType) : [];

    const txArray: HistoryDto<T>[] = [
      await this.getBuyCryptoTransactions(buyCryptos, exportType),
      await this.getBuyFiatTransactions(buyFiats, exportType),
      await this.getRefRewards(refRewards, exportType),
      staking,
    ].flat();

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

  private async getStakingTransactions<T>(
    user: User | UserData,
    query: HistoryQuery,
    exportType: T,
  ): Promise<HistoryDto<T>[]> {
    const userIds = user instanceof UserData ? user.users.map((u) => u.id) : [user.id];

    const stakingInvests = await this.stakingService.getUserInvests(userIds, query.from, query.to);
    const stakingRewards = await this.stakingService.getUserStakingRewards(userIds, query.from, query.to);
    const refStakingReward = await this.stakingService.getUserStakingRefRewards(userIds, query.from, query.to);

    return [
      this.getStakingInvests(stakingInvests?.deposits, stakingInvests?.withdrawals, exportType),
      this.getStakingRewards(stakingRewards, refStakingReward, exportType),
    ].flat();
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
