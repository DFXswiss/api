import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Between, In, Not } from 'typeorm';
import { TransactionDetailsDto } from '../../../statistic/dto/statistic.dto';
import { CreateManualRefRewardDto } from '../dto/create-ref-reward.dto';
import { UpdateRefRewardDto } from '../dto/update-ref-reward.dto';
import { RefReward, RewardStatus } from '../ref-reward.entity';
import { RefRewardRepository } from '../ref-reward.repository';

// min. payout limits (EUR), undefined -> payout disabled
const PayoutLimits: { [k in Blockchain]: number } = {
  [Blockchain.DEFICHAIN]: undefined,
  [Blockchain.ARBITRUM]: 10,
  [Blockchain.BITCOIN]: 100,
  [Blockchain.LIGHTNING]: 1,
  [Blockchain.SPARK]: undefined,
  [Blockchain.MONERO]: 1,
  [Blockchain.ZANO]: undefined,
  [Blockchain.CARDANO]: undefined,
  [Blockchain.ETHEREUM]: 10,
  [Blockchain.SEPOLIA]: undefined,
  [Blockchain.BINANCE_SMART_CHAIN]: undefined,
  [Blockchain.OPTIMISM]: undefined,
  [Blockchain.POLYGON]: undefined,
  [Blockchain.BASE]: undefined,
  [Blockchain.SOLANA]: undefined,
  [Blockchain.HAQQ]: undefined,
  [Blockchain.LIQUID]: undefined,
  [Blockchain.ARWEAVE]: undefined,
  [Blockchain.RAILGUN]: undefined,
  [Blockchain.BINANCE_PAY]: undefined,
  [Blockchain.KUCOIN_PAY]: undefined,
  [Blockchain.GNOSIS]: undefined,
  [Blockchain.TRON]: undefined,
  [Blockchain.CITREA_TESTNET]: undefined,
  [Blockchain.KRAKEN]: undefined,
  [Blockchain.BINANCE]: undefined,
  [Blockchain.XT]: undefined,
  [Blockchain.MEXC]: undefined,
  [Blockchain.MAERKI_BAUMANN]: undefined,
  [Blockchain.OLKYPAY]: undefined,
  [Blockchain.CHECKOUT]: undefined,
  [Blockchain.KALEIDO]: undefined,
  [Blockchain.SUMIXX]: undefined,
  [Blockchain.YAPEAL]: undefined,
};

@Injectable()
export class RefRewardService {
  constructor(
    private readonly rewardRepo: RefRewardRepository,
    private readonly userService: UserService,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
    private readonly transactionService: TransactionService,
  ) {}

  async createManualRefReward(dto: CreateManualRefRewardDto): Promise<void> {
    const user = await this.userService.getUser(dto.user.id, { userData: true });
    if (!user) throw new NotFoundException('User not found');

    const asset = await this.assetService.getAssetById(dto.asset.id);
    if (!asset) throw new NotFoundException('Asset not found');

    const sourceTransaction = await this.transactionService.getTransactionById(dto.sourceTransaction.id);
    if (!sourceTransaction) throw new NotFoundException('Source Transaction not found');
    if (await this.rewardRepo.existsBy({ sourceTransaction: { id: sourceTransaction.id } }))
      throw new BadRequestException('Source transaction already used');

    const eurChfPrice = await this.pricingService.getPrice(
      PriceCurrency.EUR,
      PriceCurrency.CHF,
      PriceValidity.VALID_ONLY,
    );

    const entity = this.rewardRepo.create({
      user,
      targetAddress: user.address,
      outputAsset: asset,
      sourceTransaction,
      status: dto.amountInEur > Config.refRewardManualCheckLimit ? RewardStatus.MANUAL_CHECK : RewardStatus.PREPARED,
      targetBlockchain: asset.blockchain,
      amountInChf: eurChfPrice.convert(dto.amountInEur, 8),
      amountInEur: dto.amountInEur,
    });

    entity.transaction = await this.transactionService.create({
      sourceType: TransactionSourceType.MANUAL_REF,
      user,
      userData: user.userData,
    });

    // update user ref balance
    await this.userService.updateRefVolume(
      user.ref,
      user.refVolume + dto.amountInEur / user.refFeePercent,
      user.refCredit + dto.amountInEur,
    );

    await this.rewardRepo.save(entity);
  }

  async createPendingRefRewards(): Promise<void> {
    const openCreditUser = await this.userService.getOpenRefCreditUser();
    if (openCreditUser.length == 0) return;

    const eurChfPrice = await this.pricingService.getPrice(
      PriceCurrency.EUR,
      PriceCurrency.CHF,
      PriceValidity.VALID_ONLY,
    );

    const groupedUser = Util.groupByAccessor<User, Blockchain>(openCreditUser, (o) =>
      CryptoService.getDefaultBlockchainBasedOn(o.address),
    );

    for (const [blockchain, users] of groupedUser.entries()) {
      const pendingBlockchainRewards = await this.rewardRepo.findOne({
        where: {
          status: Not(In([RewardStatus.COMPLETE, RewardStatus.USER_SWITCH, RewardStatus.FAILED])),
          targetBlockchain: blockchain,
        },
      });
      if (pendingBlockchainRewards) continue;

      const payoutAsset =
        blockchain === Blockchain.ETHEREUM
          ? await this.assetService.getAssetByQuery({
              blockchain,
              name: 'dEURO',
              type: AssetType.TOKEN,
            })
          : await this.assetService.getNativeAsset(blockchain);

      for (const user of users) {
        const refCreditEur = user.refCredit - user.paidRefCredit;
        const minCredit = PayoutLimits[blockchain];

        if (!(refCreditEur >= minCredit)) continue;

        const entity = this.rewardRepo.create({
          outputAsset: payoutAsset,
          user,
          status: refCreditEur > Config.refRewardManualCheckLimit ? RewardStatus.MANUAL_CHECK : RewardStatus.PREPARED,
          targetAddress: user.address,
          targetBlockchain: blockchain,
          amountInChf: eurChfPrice.convert(refCreditEur, 8),
          amountInEur: refCreditEur,
        });

        entity.transaction = await this.transactionService.create({
          sourceType: TransactionSourceType.REF,
          user,
          userData: user.userData,
        });

        await this.rewardRepo.save(entity);
      }
    }
  }

  async updateVolumes(): Promise<void> {
    const userIds = await this.userService.getAllUser().then((l) => l.map((b) => b.id));
    await this.updatePaidRefCredit(userIds);
  }

  async updateRefReward(id: number, dto: UpdateRefRewardDto): Promise<RefReward> {
    const entity = await this.rewardRepo.findOneBy({ id });
    if (!entity) throw new Error('RefReward not found');
    if ([RewardStatus.COMPLETE, RewardStatus.PAYING_OUT].includes(entity.status))
      throw new BadRequestException('RefReward already complete');

    Object.assign(entity, dto);

    return this.rewardRepo.save(entity);
  }

  async getAllUserRewards(userIds: number[]): Promise<RefReward[]> {
    return this.rewardRepo.find({
      where: { user: { id: In(userIds) } },
      relations: { user: true },
      order: { id: 'DESC' },
    });
  }

  async getRefRewardVolume(from: Date): Promise<number> {
    const { volume } = await this.rewardRepo
      .createQueryBuilder('refReward')
      .select('SUM(amountInChf)', 'volume')
      .where('created >= :from', { from })
      .andWhere('status NOT IN (:...rewardStatus)', { rewardStatus: [RewardStatus.FAILED, RewardStatus.USER_SWITCH] })
      .getRawOne<{ volume: number }>();

    return volume ?? 0;
  }

  // --- HELPER METHODS --- //
  async updatePaidRefCredit(userIds: number[]): Promise<void> {
    userIds = userIds.filter((u, j) => userIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of userIds) {
      const { volume } = await this.rewardRepo
        .createQueryBuilder('refReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('refReward.user', 'user')
        .where('user.id = :id', { id })
        .andWhere('refReward.status IN (:...status)', { status: [RewardStatus.COMPLETE, RewardStatus.USER_SWITCH] })
        .getRawOne<{ volume: number }>();

      await this.userService.updatePaidRefCredit(id, volume ?? 0);
    }
  }

  async getTransactions(dateFrom: Date = new Date(0), dateTo: Date = new Date()): Promise<TransactionDetailsDto[]> {
    const refRewards = await this.rewardRepo.findBy({
      outputDate: Between(dateFrom, dateTo),
      status: Not(RewardStatus.USER_SWITCH),
    });

    return refRewards.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.outputAsset.dexName,
    }));
  }
}
