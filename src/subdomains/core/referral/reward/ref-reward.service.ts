import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { Between, In, IsNull, Not } from 'typeorm';
import { RefRewardExtended } from '../../history/mappers/transaction-dto.mapper';
import { TransactionDetailsDto } from '../../statistic/dto/statistic.dto';
import { RefRewardDexService } from './ref-reward-dex.service';
import { RefRewardNotificationService } from './ref-reward-notification.service';
import { RefRewardOutService } from './ref-reward-out.service';
import { RefReward, RewardStatus } from './ref-reward.entity';
import { RefRewardRepository } from './ref-reward.repository';

// min. payout limits (EUR), undefined -> payout disabled
const PayoutLimits: { [k in Blockchain]: number } = {
  [Blockchain.DEFICHAIN]: undefined,
  [Blockchain.ARBITRUM]: 10,
  [Blockchain.BITCOIN]: 100,
  [Blockchain.LIGHTNING]: undefined,
  [Blockchain.MONERO]: 1,
  [Blockchain.CARDANO]: undefined,
  [Blockchain.ETHEREUM]: undefined,
  [Blockchain.BINANCE_SMART_CHAIN]: undefined,
  [Blockchain.OPTIMISM]: undefined,
  [Blockchain.POLYGON]: undefined,
  [Blockchain.BASE]: undefined,
  [Blockchain.LIQUID]: undefined,
};

@Injectable()
export class RefRewardService {
  constructor(
    private readonly rewardRepo: RefRewardRepository,
    private readonly userService: UserService,
    private readonly cryptoService: CryptoService,
    private readonly priceProviderService: PriceProviderService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly refRewardNotificationService: RefRewardNotificationService,
    private readonly refRewardDexService: RefRewardDexService,
    private readonly refRewardOutService: RefRewardOutService,
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  @Lock(1800)
  async createPendingRefRewards() {
    if (DisabledProcess(Process.REF_PAYOUT)) return;

    const openCreditUser = await this.userService.getOpenRefCreditUser();
    if (openCreditUser.length == 0) return;

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');
    const eurChfPrice = await this.priceProviderService.getPrice(fiatEur, fiatChf);

    const groupedUser = Util.groupByAccessor<User, Blockchain>(openCreditUser, (o) =>
      this.cryptoService.getDefaultBlockchainBasedOn(o.address),
    );

    for (const [blockchain, users] of groupedUser.entries()) {
      const pendingBlockchainRewards = await this.rewardRepo.findOne({
        where: { status: Not(RewardStatus.COMPLETE), targetBlockchain: blockchain },
      });
      if (pendingBlockchainRewards) continue;

      const payoutAsset = await this.assetService.getNativeAsset(blockchain);

      for (const user of users) {
        const refCreditEur = user.refCredit - user.paidRefCredit;
        const minCredit = PayoutLimits[blockchain];

        if (!(refCreditEur >= minCredit)) continue;

        const entity = this.rewardRepo.create({
          outputAsset: payoutAsset.dexName,
          user: user,
          status: RewardStatus.PREPARED,
          targetAddress: user.address,
          targetBlockchain: blockchain,
          amountInChf: eurChfPrice.convert(refCreditEur, 8),
          amountInEur: refCreditEur,
        });

        await this.rewardRepo.save(entity);
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(1800)
  async processPendingRefRewards() {
    if (DisabledProcess(Process.REF_PAYOUT)) return;

    await this.refRewardDexService.secureLiquidity();
    await this.refRewardOutService.checkPaidTransaction();
    await this.refRewardOutService.payoutNewTransactions();
    await this.refRewardNotificationService.sendNotificationMails();
  }

  async updateVolumes(): Promise<void> {
    const userIds = await this.userService.getAllUser().then((l) => l.map((b) => b.id));
    await this.updatePaidRefCredit(userIds);
  }

  async getUserRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<RefReward[]> {
    return this.rewardRepo.find({
      where: { user: { id: In(userIds) }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['user'],
    });
  }

  async getAllUserRewards(userIds: number[]): Promise<RefReward[]> {
    return this.rewardRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ['user'],
      order: { id: 'DESC' },
    });
  }

  async extendReward(reward: RefReward): Promise<RefRewardExtended> {
    const outputAssetEntity = await this.assetService.getNativeAsset(reward.targetBlockchain);

    return Object.assign(reward, { outputAssetEntity });
  }

  // --- HELPER METHODS --- //
  private async updatePaidRefCredit(userIds: number[]): Promise<void> {
    userIds = userIds.filter((u, j) => userIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of userIds) {
      const { volume } = await this.rewardRepo
        .createQueryBuilder('refReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('refReward.user', 'user')
        .where('user.id = :id', { id })
        .getRawOne<{ volume: number }>();

      await this.userService.updatePaidRefCredit(id, volume ?? 0);
    }
  }

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const refRewards = await this.rewardRepo.findBy({ outputDate: Between(dateFrom, dateTo) });

    return refRewards.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.outputAsset,
    }));
  }
}
