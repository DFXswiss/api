import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { In, SelectQueryBuilder } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { DepositService } from '../deposit/deposit.service';
import { Sell } from '../sell/sell.entity';
import { SellRepository } from '../sell/sell.repository';
import { KycCompleted } from '../../../user/models/user-data/user-data.entity';
import { CreateStakingDto } from './dto/create-staking.dto';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { StakingDto } from './dto/staking.dto';
import { UpdateStakingDto } from './dto/update-staking.dto';
import { Staking } from './staking.entity';
import { StakingRepository } from './staking.repository';
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { CryptoInputRepository } from '../crypto-input/crypto-input.repository';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyRepository } from '../buy/buy.repository';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/util';
import { Config } from 'src/config/config';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { RouteType } from '../route/deposit-route.entity';

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRepo: StakingRepository,
    private readonly depositService: DepositService,
    private readonly sellRepo: SellRepository,
    private readonly userDataService: UserDataService,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly assetService: AssetService,
    private readonly buyRepo: BuyRepository,
    private readonly settingService: SettingService,
  ) {}

  async getStakingByAddress(depositAddress: string): Promise<Staking> {
    // does not work with find options
    return this.stakingRepo
      .createQueryBuilder('staking')
      .leftJoinAndSelect('staking.deposit', 'deposit')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  async getStaking(id: number, userId: number): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ where: { id, user: { id: userId } } });
    if (!staking) throw new NotFoundException('Staking route not found');

    return staking;
  }

  async getUserStaking(userId: number): Promise<Staking[]> {
    return this.stakingRepo.find({ user: { id: userId } });
  }

  async getUserStakingByAddress(address: string): Promise<Staking[]> {
    return await this.stakingRepo.find({ where: { user: { address: address } }, relations: ['user'] });
  }

  async createStaking(userId: number, dto: CreateStakingDto): Promise<Staking> {
    // KYC check
    const { kycStatus } = await this.userDataService.getUserDataByUser(userId);
    if (!KycCompleted(kycStatus)) throw new BadRequestException('Missing KYC');

    // max. 10 routes
    const routeCount = await this.stakingRepo.count({ user: { id: userId } });
    if (routeCount >= 10) throw new BadRequestException('Max. 10 staking routes allowed');

    const staking = await this.createEntity(userId, dto);
    return this.stakingRepo.save(staking);
  }

  async updateStaking(userId: number, stakingId: number, dto: UpdateStakingDto): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ id: stakingId, user: { id: userId } });
    if (!staking) throw new NotFoundException('Staking route not found');

    const update = await this.createEntity(userId, dto, staking);
    return await this.stakingRepo.save(update);
  }

  private async createEntity(
    userId: number,
    dto: CreateStakingDto | UpdateStakingDto,
    staking?: Staking,
  ): Promise<Staking> {
    staking ??= this.stakingRepo.create({
      user: { id: userId },
      deposit: await this.depositService.getNextDeposit(),
    });

    staking.rewardDeposit =
      dto.rewardType === PayoutType.REINVEST
        ? staking.deposit
        : dto.rewardType === PayoutType.BANK_ACCOUNT
        ? ({ id: await this.getDepositId(userId, dto.rewardSell?.id) } as Deposit)
        : null;
    staking.paybackDeposit =
      dto.paybackType === PayoutType.REINVEST
        ? staking.deposit
        : dto.paybackType === PayoutType.BANK_ACCOUNT
        ? ({ id: await this.getDepositId(userId, dto.paybackSell?.id) } as Deposit)
        : null;

    staking.rewardAsset = dto.rewardType === PayoutType.WALLET ? await this.getAsset(dto.rewardAsset?.id) : null;
    staking.paybackAsset = dto.paybackType === PayoutType.WALLET ? await this.getAsset(dto.paybackAsset?.id) : null;

    if ('active' in dto && dto.active != null) staking.active = dto.active;

    return staking;
  }

  async getAllIds(): Promise<number[]> {
    return this.stakingRepo.find({ select: ['id'] }).then((results) => results.map((r) => r.id));
  }

  async getUserStakingDepositsInUse(userId: number): Promise<number[]> {
    const buyRoutes = await this.buyRepo.find({ user: { id: userId } });
    return buyRoutes
      .filter((s) => s.active)
      .map((s) => s.deposit?.id)
      .filter((id) => id);
  }

  public async getStakingYield(): Promise<{ apr: number; apy: number }> {
    const lastDfiRewards = await this.settingService.get('stakingRewards');
    const lastDfiCollateral = await this.settingService.get('stakingCollateral');

    const apr = await this.getApr(+lastDfiRewards, +lastDfiCollateral);
    return {
      apr: Util.round(apr, 2),
      apy: Util.round(this.getApy(apr), 2),
    };
  }

  async updateRewardVolume(stakingId: number, volume: number): Promise<void> {
    await this.stakingRepo.update(stakingId, { rewardVolume: Util.round(volume, 0) });
  }

  // --- DTO --- //
  async toDtoList(userId: number, staking: Staking[]): Promise<StakingDto[]> {
    const depositIds = staking
      .map((s) => [s.rewardDeposit?.id, s.paybackDeposit?.id])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((id) => id);
    const sellRoutes = await this.sellRepo.find({ where: { deposit: { id: In(depositIds) } }, relations: ['deposit'] });

    const stakingDepositsInUse = await this.getUserStakingDepositsInUse(userId);

    return Promise.all(staking.map((s) => this.toDto(userId, s, sellRoutes, stakingDepositsInUse)));
  }

  async toDto(
    userId: number,
    staking: Staking,
    sellRoutes?: Sell[],
    stakingDepositsInUse?: number[],
  ): Promise<StakingDto> {
    const rewardType = this.getPayoutType(staking.rewardDeposit?.id, staking.deposit.id);
    const paybackType = this.getPayoutType(staking.paybackDeposit?.id, staking.deposit.id);
    const balance = await this.getStakingBalance(staking.id, new Date());

    stakingDepositsInUse ??= await this.getUserStakingDepositsInUse(userId);

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
      balance: Util.round(balance, 2),
      rewardVolume: staking.rewardVolume ?? 0,
      isInUse: balance > 0 || stakingDepositsInUse.includes(staking.deposit?.id),
    };
  }

  private getPayoutType(typeDepositId: number | undefined, depositId: number): PayoutType {
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
      : await this.sellRepo.findOne({ where: { deposit: { id: depositId } } });
  }

  private async getDepositId(userId: number, sellId?: number): Promise<number> {
    const sell = await this.sellRepo.findOne({ where: { id: sellId, user: { id: userId } }, relations: ['deposit'] });
    if (!sell) throw new BadRequestException('Missing sell route');

    return sell.deposit.id;
  }

  private async getApr(dfiRewards: number, dfiCollateral: number): Promise<number> {
    return (dfiRewards / dfiCollateral) * 365;
  }

  private getApy(dfiApr: number): number {
    return Math.pow(1 + dfiApr / 365, 365) - 1;
  }

  private async getAsset(assetId?: number): Promise<Asset | null> {
    const asset: Asset = await this.assetService.getAsset(assetId);
    return asset && asset.buyable ? asset : await this.assetService.getAssetByDexName('DFI');
  }

  // --- BALANCE --- //
  async getStakingBalance(stakingId: number, date: Date): Promise<number> {
    const { balance } = await this.getInputsForStakingPeriod(date)
      .select('SUM(amount)', 'balance')
      .andWhere('route.id = :stakingId', { stakingId })
      .getRawOne<{ balance: number }>();

    return balance ?? 0;
  }

  async getAllStakingBalance(stakingIds: number[], date: Date): Promise<{ id: number; balance: number }[]> {
    return await this.getInputsForStakingPeriod(date)
      .select('route.id', 'id')
      .addSelect('SUM(amount)', 'balance')
      .andWhere('route.id IN (:...stakingIds)', { stakingIds })
      .groupBy('route.id')
      .getRawMany<{ id: number; balance: number }>();
  }

  private getInputsForStakingPeriod(dateTo: Date): SelectQueryBuilder<CryptoInput> {
    const dateFrom = Util.daysBefore(Config.stakingPeriod, dateTo);

    return this.cryptoInputRepo
      .createQueryBuilder('cryptoInput')
      .innerJoinAndSelect('cryptoInput.route', 'route')
      .where('route.type = :type', { type: RouteType.STAKING })
      .andWhere('cryptoInput.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });
  }
}
