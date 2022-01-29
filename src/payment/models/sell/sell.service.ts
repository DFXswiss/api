import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSellDto } from 'src/payment/models/sell/dto/create-sell.dto';
import { UpdateSellDto } from 'src/payment/models/sell/dto/update-sell.dto';
import { SellRepository } from 'src/payment/models/sell/sell.repository';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { UserService } from '../../../user/models/user/user.service';
import { Sell } from './sell.entity';
import { DepositService } from '../deposit/deposit.service';
import { User } from '../../../user/models/user/user.entity';
import { StakingService } from '../staking/staking.service';
import { Util } from 'src/shared/util';

@Injectable()
export class SellService {
  constructor(
    private readonly sellRepo: SellRepository,
    private readonly fiatService: FiatService,
    private readonly userService: UserService,
    private readonly depositService: DepositService,
    private readonly stakingService: StakingService,
  ) {}

  async getSellForAddress(depositAddress: string): Promise<Sell> {
    // does not work with find options
    return this.sellRepo
      .createQueryBuilder('sell')
      .leftJoinAndSelect('sell.deposit', 'deposit')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  async getUserSells(userId: number): Promise<Sell[]> {
    return this.sellRepo.find({ user: { id: userId } });
  }

  async createSell(userId: number, dto: CreateSellDto): Promise<Sell> {
    // check user data
    const verification = await this.userService.verifyUser(userId);
    if (!verification.result) throw new BadRequestException('User data missing');

    // check fiat
    const fiat = await this.fiatService.getFiat(dto.fiat.id);
    if (!fiat) throw new NotFoundException('No fiat for id found');

    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    // check if exists
    const existing = await this.sellRepo.findOne({ where: { iban: dto.iban, fiat: fiat, user: { id: userId } } });
    if (existing) throw new ConflictException('Sell route already exists');

    // create the entity
    const sell = this.sellRepo.create(dto);
    sell.user = { id: userId } as User;
    sell.deposit = await this.depositService.getNextDeposit();

    return this.sellRepo.save(sell);
  }

  async updateSell(userId: number, dto: UpdateSellDto): Promise<Sell> {
    const sell = await this.sellRepo.findOne({ id: dto.id, user: { id: userId } });
    if (!sell) throw new NotFoundException('No matching entry found');

    return await this.sellRepo.save({ ...sell, ...dto });
  }

  async count(): Promise<number> {
    return this.sellRepo.count();
  }

  async updateVolume(sellId: number, volume: number): Promise<void> {
    await this.sellRepo.update(sellId, { volume: Util.round(volume, 0) });
  }

  async getTotalVolume(): Promise<number> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  async getUserSellDepositsInUse(userId: number): Promise<number[]> {
    const stakingRoutes = await this.stakingService.getUserStaking(userId);
    return stakingRoutes
      .filter((s) => s.active)
      .map((s) => [
        s.deposit?.id === s.paybackDeposit?.id ? undefined : s.paybackDeposit?.id,
        s.deposit?.id === s.rewardDeposit?.id ? undefined : s.rewardDeposit?.id,
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((id) => id);
  }
}
