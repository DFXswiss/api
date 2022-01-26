import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { In, Raw } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { DepositService } from '../deposit/deposit.service';
import { Sell } from '../sell/sell.entity';
import { SellRepository } from '../sell/sell.repository';
import { User } from '../../../user/models/user/user.entity';
import { KycStatus } from '../../../user/models/userData/userData.entity';
import { CreateStakingDto } from './dto/create-staking.dto';
import { StakingType } from './dto/staking-type.enum';
import { StakingDto } from './dto/staking.dto';
import { UpdateStakingDto } from './dto/update-staking.dto';
import { Staking } from './staking.entity';
import { StakingRepository } from './staking.repository';
import { UserDataService } from 'src/user/models/userData/userData.service';
import { CryptoInputRepository } from '../crypto-input/crypto-input.repository';

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRepo: StakingRepository,
    private readonly depositService: DepositService,
    private readonly sellRepo: SellRepository,
    private readonly userDataService: UserDataService,
    private readonly cryptoInputRepo: CryptoInputRepository,
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

    const rewardDepositId =
      dto.rewardType === StakingType.PAYOUT ? await this.getDepositId(userId, dto.rewardSell?.id) : null;
    const paybackDepositId =
      dto.paybackType === StakingType.PAYOUT ? await this.getDepositId(userId, dto.paybackSell?.id) : null;

    // create the entity
    const staking = this.stakingRepo.create({});
    staking.user = { id: userId } as User;
    staking.deposit = await this.depositService.getNextDeposit();
    staking.rewardDeposit =
      dto.rewardType === StakingType.REINVEST ? staking.deposit : ({ id: rewardDepositId } as Deposit);
    staking.paybackDeposit =
      dto.paybackType === StakingType.REINVEST ? staking.deposit : ({ id: paybackDepositId } as Deposit);

    return this.stakingRepo.save(staking);
  }

  async updateStaking(userId: number, dto: UpdateStakingDto): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ id: dto.id, user: { id: userId } });
    if (!staking) throw new NotFoundException('No matching entry found');

    return await this.stakingRepo.save({ ...staking, ...dto });
  }

  async getAllIds(): Promise<number[]> {
    return this.stakingRepo
      .createQueryBuilder('staking')
      .select('staking.id', 'id')
      .getRawMany<{ id: number }>()
      .then((results) => results.map((r) => r.id));
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

    return {
      id: staking.id,
      active: staking.active,
      deposit: staking.deposit,
      rewardType,
      rewardSell: await this.getSell(rewardType, staking.rewardDeposit?.id, sellRoutes),
      paybackType,
      paybackSell: await this.getSell(paybackType, staking.paybackDeposit?.id, sellRoutes),
      balance: await this.cryptoInputRepo.getStakingBalance(staking.id, new Date()),
    };
  }

  private getStakingType(typeDepositId: number | undefined, depositId: number): StakingType {
    return typeDepositId
      ? typeDepositId === depositId
        ? StakingType.REINVEST
        : StakingType.PAYOUT
      : StakingType.WALLET;
  }

  private async getSell(stakingType: StakingType, depositId: number, sellRoutes?: Sell[]): Promise<Sell | undefined> {
    if (stakingType !== StakingType.PAYOUT) return undefined;

    return sellRoutes
      ? sellRoutes.find((r) => r.deposit.id === depositId)
      : await this.sellRepo.findOne({ where: { deposit: { id: depositId } } });
  }

  private async getDepositId(userId: number, sellId?: number): Promise<number> {
    const sell = await this.sellRepo.findOne({ where: { id: sellId, user: { id: userId } }, relations: ['deposit'] });
    if (!sell) throw new BadRequestException('Missing sell route');

    return sell.deposit.id;
  }
}
