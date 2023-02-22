import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { Util } from 'src/shared/utils/util';
import { Config } from 'src/config/config';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StakingReturnService } from './staking-return.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Lock } from 'src/shared/utils/lock';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { StakingDto } from '../dto/staking.dto';
import { PayoutType } from '../entities/staking-reward.entity';
import { Staking } from '../entities/staking.entity';
import { CryptoStakingRepository } from '../repositories/crypto-staking.repository';
import { StakingRepository } from '../repositories/staking.repository';
import { StakingRefRewardService } from './staking-ref-reward.service';
import { CryptoRoute } from '../../buy-crypto/routes/crypto-route/crypto-route.entity';

@Injectable()
export class StakingService {
  private readonly returnLock = new Lock(1800);

  constructor(
    private readonly stakingRepo: StakingRepository,
    @Inject(forwardRef(() => SellService))
    private readonly sellService: SellService,
    private readonly stakingReturnService: StakingReturnService,
    private readonly cryptoStakingRepo: CryptoStakingRepository,
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly stakingRefRewardService: StakingRefRewardService,
    private readonly settingService: SettingService,
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  async checkCryptoPayIn() {
    if ((await this.settingService.get('staking-return')) !== 'on') return;
    if (!this.returnLock.acquire()) return;

    try {
      await this.stakingReturnService.returnStakingPayIn();
    } catch (e) {
      console.error('Error during staking-return pay-in registration', e);
    } finally {
      this.returnLock.release();
    }
  }

  async getStaking(id: number, userId: number): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ where: { id, user: { id: userId } } });
    if (!staking) throw new NotFoundException('Staking route not found');

    return staking;
  }

  async getUserStaking(userId: number): Promise<Staking[]> {
    return this.stakingRepo.find({ user: { id: userId } });
  }

  async getStakingByUserAddresses(addresses: string[]): Promise<Staking[]> {
    return this.stakingRepo.find({ where: { user: { address: In(addresses) } }, relations: ['user'] });
  }

  async getStakingByDepositAddresses(addresses: string[]): Promise<Staking[]> {
    return this.stakingRepo.find({ where: { deposit: { address: In(addresses) } }, relations: ['deposit'] });
  }

  async getStakingByCryptoRoute(cryptos: CryptoRoute[]) {
    return this.stakingRepo.find({
      deposit: { id: In(cryptos.map((b) => b.targetDeposit?.id)) },
    });
  }

  async getAllIds(): Promise<number[]> {
    return this.stakingRepo.find({ select: ['id'] }).then((results) => results.map((r) => r.id));
  }

  async updateRewardVolume(stakingId: number, volume: number): Promise<void> {
    await this.stakingRepo.update(stakingId, { rewardVolume: Util.round(volume, Config.defaultVolumeDecimal) });
  }

  // --- BALANCE --- //
  async updateBalance(stakingId: number): Promise<void> {
    const staking = await this.stakingRepo.findOne({ where: { id: stakingId }, relations: ['user'] });

    // update balance
    const balance = await this.getCurrentStakingBalance(stakingId);
    await this.stakingRepo.update(stakingId, { volume: Util.round(balance, Config.defaultVolumeDecimal) });
    await this.updateUserBalance(staking.user.id);

    // set staking start
    if (staking.user.stakingStart == null && balance >= Config.staking.minInvestment) {
      const isNewUser = await this.userService.activateStaking(staking.user.id);
      if (isNewUser) {
        await this.stakingRefRewardService.create(staking);
      }
    }
  }

  async updateUserBalance(userId: number): Promise<void> {
    const { userBalance } = await this.stakingRepo
      .createQueryBuilder('staking')
      .select('SUM(volume)', 'userBalance')
      .where('userId = :id', { id: userId })
      .getRawOne<{ userBalance: number }>();
    await this.userService.updateStakingBalance(userId, userBalance);
  }

  async getCurrentStakingBalance(stakingId: number): Promise<number> {
    const { balance } = await this.cryptoStakingRepo
      .getActiveEntries()
      .select('SUM(inputAmount)', 'balance')
      .andWhere('cryptoStaking.stakingRouteId = :stakingId', { stakingId })
      .getRawOne<{ balance: number }>();

    return balance ?? 0;
  }

  async getTotalStakingRewards(): Promise<number> {
    return this.stakingRepo
      .createQueryBuilder('staking')
      .select('SUM(rewardVolume)', 'rewardVolume')
      .getRawOne<{ rewardVolume: number }>()
      .then((r) => r.rewardVolume);
  }

  async getStakingBalance(stakingIds: number[], date?: Date): Promise<{ id: number; balance: number }[]> {
    return this.cryptoStakingRepo
      .getActiveEntries(date)
      .select('cryptoStaking.stakingRouteId', 'id')
      .addSelect('SUM(inputAmount)', 'balance')
      .andWhere('cryptoStaking.stakingRouteId IN (:...stakingIds)', { stakingIds })
      .groupBy('cryptoStaking.stakingRouteId')
      .getRawMany<{ id: number; balance: number }>();
  }

  async getAllStakingBalance(date?: Date): Promise<{ id: number; balance: number }[]> {
    return this.cryptoStakingRepo
      .getActiveEntries(date)
      .select('cryptoStaking.stakingRouteId', 'id')
      .addSelect('SUM(inputAmount)', 'balance')
      .groupBy('cryptoStaking.stakingRouteId')
      .getRawMany<{ id: number; balance: number }>();
  }

  async getTotalStakingBalance(date?: Date): Promise<number> {
    return this.cryptoStakingRepo
      .getActiveEntries(date)
      .select('SUM(inputAmount)', 'balance')
      .getRawOne<{ balance: number }>()
      .then((b) => b.balance);
  }

  // --- DTO --- //
  async toDtoList(userId: number, staking: Staking[]): Promise<StakingDto[]> {
    const depositIds = staking
      .map((s) => [s.rewardDeposit?.id, s.paybackDeposit?.id])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((id) => id);
    const sellRoutes = await this.sellService.getSellRepo().find({
      where: { deposit: { id: In(depositIds) } },
      relations: ['deposit'],
    });

    const stakingDepositsInUse = await this.getUserStakingDepositsInUse(userId);
    const fee = await this.userService.getUserStakingFee(userId);

    return Promise.all(staking.map((s) => this.toDto(userId, s, sellRoutes, stakingDepositsInUse, fee)));
  }

  async toDto(
    userId: number,
    staking: Staking,
    sellRoutes?: Sell[],
    stakingDepositsInUse?: number[],
    fee?: number,
  ): Promise<StakingDto> {
    const rewardType = this.getPayoutType(staking.rewardDeposit?.id, staking.deposit.id);
    const paybackType = this.getPayoutType(staking.paybackDeposit?.id, staking.deposit.id);

    stakingDepositsInUse ??= await this.getUserStakingDepositsInUse(userId);
    fee ??= await this.userService.getUserStakingFee(userId);

    return {
      id: staking.id,
      active: staking.active,
      deposit: staking.deposit,
      rewardType,
      rewardSell: await this.getSell(rewardType, staking.rewardDeposit?.id, sellRoutes),
      rewardAsset: staking.rewardAsset ?? undefined,
      paybackType,
      paybackSell: await this.getSell(paybackType, staking.paybackDeposit?.id, sellRoutes),
      paybackAsset: staking.paybackAsset ?? undefined,
      balance: Util.round(staking.volume, Config.defaultVolumeDecimal),
      rewardVolume: staking.rewardVolume ?? 0,
      isInUse: staking.volume > 0 || stakingDepositsInUse.includes(staking.deposit?.id),
      fee: fee,
      period: Config.staking.period,
      minInvestment: Config.staking.minInvestment,
      minDeposits: Config.transformToMinDeposit(Config.blockchain.default.minDeposit.DeFiChain, 'DFI'),
    };
  }

  //*** GETTERS ***//

  getStakingRepo(): StakingRepository {
    return this.stakingRepo;
  }

  //*** HELPER METHODS ***//

  private async getUserStakingDepositsInUse(userId: number): Promise<number[]> {
    const buyRoutes = await this.buyService.getBuyRepo().find({ user: { id: userId } });
    return buyRoutes
      .filter((s) => s.active)
      .map((s) => s.deposit?.id)
      .filter((id) => id);
  }

  public getPayoutType(typeDepositId: number | undefined, depositId: number): PayoutType {
    return typeDepositId
      ? typeDepositId === depositId
        ? PayoutType.REINVEST
        : PayoutType.BANK_ACCOUNT
      : PayoutType.WALLET;
  }

  private async getSell(payoutType: PayoutType, depositId: number, sellRoutes?: Sell[]): Promise<Sell | undefined> {
    if (payoutType !== PayoutType.BANK_ACCOUNT) return undefined;

    return sellRoutes
      ? sellRoutes.find((r) => r.deposit.id === depositId)
      : this.sellService.getSellRepo().findOne({ where: { deposit: { id: depositId } } });
  }
}
