import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { DepositService } from '../deposit/deposit.service';
import { Sell } from '../sell/sell.entity';
import { SellRepository } from '../sell/sell.repository';
import { KycStatus } from '../../../user/models/userData/userData.entity';
import { CreateStakingDto } from './dto/create-staking.dto';
import { StakingType } from './dto/staking-type.enum';
import { StakingDto } from './dto/staking.dto';
import { UpdateStakingDto } from './dto/update-staking.dto';
import { Staking } from './staking.entity';
import { StakingRepository } from './staking.repository';
import { UserDataService } from 'src/user/models/userData/userData.service';
import { CryptoInputRepository } from '../crypto-input/crypto-input.repository';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/setting/setting.service';

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRepo: StakingRepository,
    private readonly depositService: DepositService,
    private readonly sellRepo: SellRepository,
    private readonly userDataService: UserDataService,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly assetService: AssetService,
    private readonly settingService: SettingService,
  ) {}

  async getStakingForAddress(depositAddress: string): Promise<Staking> {
    // does not work with find options
    return this.stakingRepo
      .createQueryBuilder('staking')
      .leftJoinAndSelect('staking.deposit', 'deposit')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  async getStaking(id: number, userId: number): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ where: { id, user: { id: userId } } });
    if (!staking) throw new NotFoundException('No matching staking route for id found');

    return staking;
  }

  async getUserStaking(userId: number): Promise<Staking[]> {
    return this.stakingRepo.find({ user: { id: userId } });
  }

  async createStaking(userId: number, dto: CreateStakingDto): Promise<Staking> {
    // KYC check
    const kycStatus = await this.userDataService.getKycStatus(userId);
    if (![KycStatus.WAIT_MANUAL, KycStatus.COMPLETED].includes(kycStatus)) throw new BadRequestException('Missing KYC');

    // max. 10 routes
    const routeCount = await this.stakingRepo.count({ user: { id: userId } });
    if (routeCount >= 10) throw new BadRequestException('Max. 10 staking routes allowed');

    const staking = await this.createEntity(userId, dto);
    return this.stakingRepo.save(staking);
  }

  async updateStaking(userId: number, dto: UpdateStakingDto): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ id: dto.id, user: { id: userId } });
    if (!staking) throw new NotFoundException('No matching entry found');

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
      dto.rewardType === StakingType.REINVEST
        ? staking.deposit
        : dto.rewardType === StakingType.BANK_ACCOUNT
        ? ({ id: await this.getDepositId(userId, dto.rewardSell?.id) } as Deposit)
        : null;
    staking.paybackDeposit =
      dto.paybackType === StakingType.REINVEST
        ? staking.deposit
        : dto.paybackType === StakingType.BANK_ACCOUNT
        ? ({ id: await this.getDepositId(userId, dto.paybackSell?.id) } as Deposit)
        : null;

    staking.rewardAsset = dto.rewardType === StakingType.WALLET ? await this.getAsset(dto.rewardAsset?.id) : null;
    staking.paybackAsset = dto.paybackType === StakingType.WALLET ? await this.getAsset(dto.paybackAsset?.id) : null;

    if ('active' in dto && dto.active != null) staking.active = dto.active;

    return staking;
  }

  async getAllIds(): Promise<number[]> {
    return this.stakingRepo.find({ select: ['id'] }).then((results) => results.map((r) => r.id));
  }

  // --- DTO --- //
  async toDtoList(staking: Staking[]): Promise<StakingDto[]> {
    const depositIds = staking
      .map((s) => [s.rewardDeposit?.id, s.paybackDeposit?.id])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((id) => id);

    const sellRoutes = await this.sellRepo.find({ where: { deposit: { id: In(depositIds) } }, relations: ['deposit'] });

    return Promise.all(staking.map((s) => this.toDto(s, sellRoutes)));
  }

  async toDto(staking: Staking, sellRoutes?: Sell[]): Promise<StakingDto> {
    const rewardType = this.getStakingType(staking.rewardDeposit?.id, staking.deposit.id);
    const paybackType = this.getStakingType(staking.paybackDeposit?.id, staking.deposit.id);
    const balance = await this.cryptoInputRepo.getStakingBalance(staking.id, new Date());

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
      balance,
      isInUse: balance > 0,
    };
  }

  private getStakingType(typeDepositId: number | undefined, depositId: number): StakingType {
    return typeDepositId
      ? typeDepositId === depositId
        ? StakingType.REINVEST
        : StakingType.BANK_ACCOUNT
      : StakingType.WALLET;
  }

  private async getSell(stakingType: StakingType, depositId: number, sellRoutes?: Sell[]): Promise<Sell | undefined> {
    if (stakingType !== StakingType.BANK_ACCOUNT) return undefined;

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

  private async getApy(dfiApr: number): Promise<number> {
    return Math.pow(1 + dfiApr / 365, 365) - 1;
  }

  public async getStakingYield(): Promise<any> {
    const lastDfiRewards = await this.settingService.get('stakingRewards');
    const lastDfiCollateral = await this.settingService.get('stakingCollateral');
    return {
      apr: (await this.getApr(+lastDfiRewards, +lastDfiCollateral)).toFixed(2),
      apy: (await this.getApy(await this.getApr(+lastDfiRewards, +lastDfiCollateral))).toFixed(2),
    };
  }

  private async getAsset(assetId?: number): Promise<Asset | null> {
    const asset: Asset = await this.assetService.getAsset(assetId);
    return asset && asset.buyable ? asset : await this.assetService.getAsset('DFI');
  }
}
