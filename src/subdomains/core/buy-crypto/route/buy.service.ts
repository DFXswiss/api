import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { Buy } from './buy.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, Not, Repository } from 'typeorm';
import { Util } from 'src/shared/utils/util';
import { BuyType } from './dto/buy-type.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Config } from 'src/config/config';
import { StakingService } from 'src/mix/models/staking/staking.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { BuyRepository } from './buy.repository';
import { CreateBuyDto } from './dto/create-buy.dto';

@Injectable()
export class BuyService {
  constructor(
    private readonly buyRepo: BuyRepository,
    private readonly assetService: AssetService,
    @Inject(forwardRef(() => StakingService))
    private readonly stakingService: StakingService,
    private readonly userService: UserService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.buyRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(buyId: number, volume: number, annualVolume: number): Promise<void> {
    await this.buyRepo.update(buyId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.buyRepo.findOne({
      where: { id: buyId },
      relations: ['user'],
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateBuyVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  // --- BUYS --- //
  async createBuy(userId: number, userAddress: string, dto: CreateBuyDto, ignoreExisting = false): Promise<Buy> {
    // check asset
    const asset =
      dto.type === BuyType.WALLET
        ? await this.assetService.getAssetById(dto.asset.id)
        : await this.assetService.getDfiCoin();

    if (!asset) throw new BadRequestException('Asset not found');

    // check staking
    const staking = dto.type === BuyType.STAKING ? await this.stakingService.getStaking(dto.staking.id, userId) : null;
    if (dto.type === BuyType.STAKING && !staking) throw new BadRequestException('Staking route not found');

    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    // check if exists
    const existing = await this.buyRepo.findOne({
      where: {
        iban: dto.iban,
        ...(dto.type === BuyType.WALLET ? { asset: asset, deposit: IsNull() } : { deposit: staking?.deposit }),
        user: { id: userId },
      },
      relations: ['deposit', 'bankAccount', 'user', 'user.userData'],
    });

    if (existing) {
      if (existing.active && !ignoreExisting) throw new ConflictException('Buy route already exists');

      if (!existing.active) {
        // reactivate deleted route
        existing.active = true;
        await this.buyRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = await this.userService.getUser(userId, true);
    buy.asset = asset;
    buy.deposit = staking?.deposit ?? null;
    buy.bankAccount = await this.bankAccountService.getOrCreateBankAccount(dto.iban, userId);

    // create hash
    const hash = Util.createHash(
      userAddress + (dto.type === BuyType.WALLET ? asset.name : staking.deposit.address) + buy.iban,
    ).toUpperCase();
    buy.bankUsage = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;

    // save
    return this.buyRepo.save(buy);
  }

  async getUserBuys(userId: number): Promise<Buy[]> {
    return this.buyRepo.find({ user: { id: userId } });
  }

  async updateBuy(userId: number, buyId: number, dto: UpdateBuyDto): Promise<Buy> {
    const buy = await this.buyRepo.findOne({ id: buyId, user: { id: userId } });
    if (!buy) throw new NotFoundException('Buy route not found');

    return await this.buyRepo.save({ ...buy, ...dto });
  }

  //*** GETTERS ***//

  getBuyRepo(): Repository<Buy> {
    return this.buyRepo;
  }
}
