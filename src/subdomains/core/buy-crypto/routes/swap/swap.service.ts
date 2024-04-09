import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { IsNull, Not } from 'typeorm';
import { DepositService } from '../../../../supporting/address-pool/deposit/deposit.service';
import { UpdateSwapDto } from './dto/update-swap.dto';
import { Swap } from './swap.entity';
import { SwapRepository } from './swap.repository';

@Injectable()
export class SwapService {
  constructor(
    private readonly swapRepo: SwapRepository,
    private readonly userService: UserService,
    private readonly depositService: DepositService,
    private readonly userDataService: UserDataService,
  ) {}

  async getSwapRouteByAddress(depositAddress: string): Promise<Swap> {
    // does not work with find options
    return this.swapRepo
      .createQueryBuilder('crypto')
      .leftJoinAndSelect('crypto.deposit', 'deposit')
      .leftJoinAndSelect('crypto.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  @Lock()
  async resetAnnualVolumes(): Promise<void> {
    await this.swapRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(swapId: number, volume: number, annualVolume: number): Promise<void> {
    await this.swapRepo.update(swapId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.swapRepo.findOne({
      where: { id: swapId },
      relations: ['user'],
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateCryptoVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.swapRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.swapRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  // --- SWAPS --- //
  async get(userId: number, id: number): Promise<Swap> {
    return this.swapRepo.findOne({ where: { id, user: { id: userId } }, relations: { user: true } });
  }

  async createSwap(userId: number, blockchain: Blockchain, asset: Asset, ignoreExisting = false): Promise<Swap> {
    // KYC check
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (userData.status !== UserDataStatus.ACTIVE && userData.kycLevel < KycLevel.LEVEL_30)
      throw new BadRequestException('User not allowed for swap trading');

    // check if exists
    const existing = await this.swapRepo.findOne({
      where: {
        asset: { id: asset.id },
        targetDeposit: IsNull(),
        user: { id: userId },
        deposit: { blockchain: blockchain },
      },
      relations: ['deposit', 'user'],
    });

    if (existing) {
      if (existing.active && !ignoreExisting) throw new ConflictException('Swap route already exists');

      if (!existing.active) {
        // reactivate deleted route
        existing.active = true;
        await this.swapRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const swap = this.swapRepo.create({ asset });
    swap.user = await this.userService.getUser(userId);
    swap.deposit = await this.depositService.getNextDeposit(blockchain);

    // save
    return this.swapRepo.save(swap);
  }

  async getUserSwaps(userId: number): Promise<Swap[]> {
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (!userData.hasBankTxVerification) return [];

    return this.swapRepo.find({
      where: { user: { id: userId }, asset: { buyable: true } },
      relations: { user: true },
    });
  }

  async updateSwap(userId: number, swapId: number, dto: UpdateSwapDto): Promise<Swap> {
    const swap = await this.swapRepo.findOneBy({ id: swapId, user: { id: userId } });
    if (!swap) throw new NotFoundException('Swap route not found');

    return this.swapRepo.save({ ...swap, ...dto });
  }

  //*** GETTERS ***//

  getSwapRepo(): SwapRepository {
    return this.swapRepo;
  }
}
