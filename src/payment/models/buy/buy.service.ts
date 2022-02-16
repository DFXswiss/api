import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBuyDto } from 'src/payment/models/buy/dto/create-buy.dto';
import { BuyRepository } from 'src/payment/models/buy/buy.repository';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { Buy } from './buy.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Not } from 'typeorm';
import { User } from '../../../user/models/user/user.entity';
import { Util } from 'src/shared/util';
import { StakingService } from '../staking/staking.service';
import { BuyType } from './dto/buy-type.enum';

@Injectable()
export class BuyService {
  constructor(
    private readonly buyRepo: BuyRepository,
    private readonly assetService: AssetService,
    private readonly stakingService: StakingService,
  ) {}

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    this.buyRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(buyId: number, volume: number, annualVolume: number): Promise<void> {
    await this.buyRepo.update(buyId, { volume: Util.round(volume, 0), annualVolume: Util.round(annualVolume, 0) });
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
  async createBuy(userId: number, userAddress: string, dto: CreateBuyDto): Promise<Buy> {
    // check asset
    const asset =
      dto.type === BuyType.WALLET
        ? await this.assetService.getAsset(dto.asset.id)
        : await this.assetService.getAssetByDexName('DFI');
    if (!asset) throw new NotFoundException('No asset for id found');

    // check staking
    const staking = dto.type === BuyType.STAKING ? await this.stakingService.getStaking(dto.staking.id, userId) : null;
    if (dto.type === BuyType.STAKING && !staking) throw new NotFoundException('No staking for id found');

    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    // check if exists
    const existing = await this.buyRepo.findOne({
      where: {
        iban: dto.iban,
        ...(dto.type === BuyType.WALLET ? { asset: asset } : { deposit: staking?.deposit }),
        user: { id: userId },
      },
      relations: ['deposit'],
    });
    if (existing) throw new ConflictException('Buy route already exists');

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = { id: userId } as User;
    buy.asset = asset;
    buy.deposit = staking?.deposit ?? null;

    // create hash
    const hash = Util.createHash(userAddress + (dto.type === BuyType.WALLET ? asset.name : staking.deposit.address) + buy.iban);
    buy.bankUsage = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;

    // save
    return this.buyRepo.save(buy);
  }

  async getUserBuys(userId: number): Promise<Buy[]> {
    return this.buyRepo.find({ user: { id: userId } });
  }

  async updateBuy(userId: number, dto: UpdateBuyDto): Promise<Buy> {
    const buy = await this.buyRepo.findOne({ id: dto.id, user: { id: userId } });
    if (!buy) throw new NotFoundException('No matching entry found');

    return await this.buyRepo.save({ ...buy, ...dto });
  }

  async count(): Promise<number> {
    return this.buyRepo.count();
  }
}
