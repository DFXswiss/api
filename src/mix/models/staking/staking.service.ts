import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { In, Raw } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { DepositService } from '../deposit/deposit.service';
import { Sell } from '../../../subdomains/core/sell-crypto/sell/sell.entity';
import { KycCompleted } from '../../../subdomains/generic/user/models/user-data/user-data.entity';
import { CreateStakingDto } from './dto/create-staking.dto';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { StakingDto } from './dto/staking.dto';
import { UpdateStakingDto } from './dto/update-staking.dto';
import { Staking } from './staking.entity';
import { StakingRepository } from './staking.repository';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { Config } from 'src/config/config';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CryptoStakingRepository } from '../crypto-staking/crypto-staking.repository';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { StakingRefRewardService } from '../staking-ref-reward/staking-ref-reward.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BuyService } from 'src/subdomains/core/buy-crypto/route/buy.service';
import { SellService } from 'src/subdomains/core/sell-crypto/sell/sell.service';

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRepo: StakingRepository,
    private readonly depositService: DepositService,
    @Inject(forwardRef(() => SellService))
    private readonly sellService: SellService,
    private readonly userDataService: UserDataService,
    private readonly cryptoStakingRepo: CryptoStakingRepository,
    private readonly assetService: AssetService,
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly stakingRefRewardService: StakingRefRewardService,
  ) {}

  async getStakingByAddress(depositAddress: string): Promise<Staking> {
    // does not work with find options
    return this.stakingRepo
      .createQueryBuilder('staking')
      .leftJoinAndSelect('staking.deposit', 'deposit')
      .leftJoinAndSelect('staking.paybackDeposit', 'paybackDeposit')
      .leftJoinAndSelect('staking.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
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

  async getStakingByUserAddresses(addresses: string[]): Promise<Staking[]> {
    return await this.stakingRepo.find({ where: { user: { address: In(addresses) } }, relations: ['user'] });
  }

  async getStakingByDepositAddresses(addresses: string[]): Promise<Staking[]> {
    return await this.stakingRepo.find({ where: { deposit: { address: In(addresses) } }, relations: ['deposit'] });
  }

  async createStaking(userId: number, dto: CreateStakingDto): Promise<Staking> {
    // KYC check
    const { kycStatus } = await this.userDataService.getUserDataByUser(userId);
    if (!KycCompleted(kycStatus)) throw new BadRequestException('Missing KYC');

    const { status } = await this.userService.getUser(userId);
    if (status !== UserStatus.ACTIVE) throw new BadRequestException('Missing bank transaction');

    // max. 10 routes
    const routeCount = await this.stakingRepo.count({ user: { id: userId } });
    if (routeCount >= 10) throw new BadRequestException('Max. 10 staking routes allowed');

    const staking = await this.createEntity(userId, dto);

    // check if exists
    const existingInactive = await this.stakingRepo.findOne({
      where: {
        rewardDeposit: {
          id: dto.rewardType === PayoutType.REINVEST ? Raw('depositId') : staking.rewardDeposit?.id ?? null,
        },
        paybackDeposit: {
          id: dto.paybackType === PayoutType.REINVEST ? Raw('depositId') : staking.paybackDeposit?.id ?? null,
        },
        rewardAsset: { id: dto.rewardType === PayoutType.WALLET ? staking.rewardAsset.id : null },
        paybackAsset: { id: dto.paybackType === PayoutType.WALLET ? staking.paybackAsset.id : null },
        user: { id: userId },
        active: false,
      },
      relations: ['rewardDeposit', 'paybackDeposit', 'rewardAsset', 'paybackAsset'],
    });

    if (existingInactive) {
      existingInactive.active = true;
      return this.stakingRepo.save(existingInactive);
    }

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
      deposit: await this.depositService.getNextDeposit(Blockchain.DEFICHAIN),
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

  async updateRewardVolume(stakingId: number, volume: number): Promise<void> {
    await this.stakingRepo.update(stakingId, { rewardVolume: Util.round(volume, Config.defaultVolumeDecimal) });
  }

  // --- HELPER METHODS --- //
  private async getDepositId(userId: number, sellId?: number): Promise<number> {
    const sell = await this.sellService
      .getSellRepo()
      .findOne({ where: { id: sellId, user: { id: userId } }, relations: ['deposit'] });
    if (!sell) throw new BadRequestException('Missing sell route');

    return sell.deposit.id;
  }

  private async getAsset(assetId?: number): Promise<Asset | null> {
    const asset: Asset = await this.assetService.getAssetById(assetId);
    return asset && asset.buyable ? asset : await this.assetService.getDfiCoin();
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
        this.stakingRefRewardService.create(staking);
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
    return await this.stakingRepo
      .createQueryBuilder('staking')
      .select('SUM(rewardVolume)', 'rewardVolume')
      .getRawOne<{ rewardVolume: number }>()
      .then((r) => r.rewardVolume);
  }

  async getStakingBalance(stakingIds: number[], date?: Date): Promise<{ id: number; balance: number }[]> {
    return await this.cryptoStakingRepo
      .getActiveEntries(date)
      .select('cryptoStaking.stakingRouteId', 'id')
      .addSelect('SUM(inputAmount)', 'balance')
      .andWhere('cryptoStaking.stakingRouteId IN (:...stakingIds)', { stakingIds })
      .groupBy('cryptoStaking.stakingRouteId')
      .getRawMany<{ id: number; balance: number }>();
  }

  async getAllStakingBalance(date?: Date): Promise<{ id: number; balance: number }[]> {
    return await this.cryptoStakingRepo
      .getActiveEntries(date)
      .select('cryptoStaking.stakingRouteId', 'id')
      .addSelect('SUM(inputAmount)', 'balance')
      .groupBy('cryptoStaking.stakingRouteId')
      .getRawMany<{ id: number; balance: number }>();
  }

  async getTotalStakingBalance(date?: Date): Promise<number> {
    return await this.cryptoStakingRepo
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
      minDeposits: Util.transformToMinDeposit(Config.blockchain.default.minDeposit.DeFiChain, 'DFI'),
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
      : await this.sellService.getSellRepo().findOne({ where: { deposit: { id: depositId } } });
  }
}
