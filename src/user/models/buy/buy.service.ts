import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBuyDto } from 'src/user/models/buy/dto/create-buy.dto';
import { BuyRepository } from 'src/user/models/buy/buy.repository';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { Buy } from './buy.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createHash } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Not } from 'typeorm';
import { User } from '../user/user.entity';
import { Util } from 'src/shared/util';

@Injectable()
export class BuyService {
  constructor(private readonly buyRepo: BuyRepository, private readonly assetService: AssetService) {}

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

  // --- BUYS --- //
  async createBuy(userId: number, dto: CreateBuyDto): Promise<Buy> {
    // check asset
    const asset = await this.assetService.getAsset(dto.asset.id);
    if (!asset) throw new NotFoundException('No asset for id found');

    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    // check if exists
    const existing = await this.buyRepo.findOne({ where: { iban: dto.iban, asset: asset, user: { id: userId } } });
    if (existing) throw new ConflictException('Sell route already exists');

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = { id: userId } as User;

    // create hash
    const hash = createHash('sha256');
    hash.update(buy.user.address + asset.name + buy.iban);
    const hexHash = hash.digest('hex').toUpperCase();
    buy.bankUsage = `${hexHash.slice(0, 4)}-${hexHash.slice(4, 8)}-${hexHash.slice(8, 12)}`;

    // save
    return this.buyRepo.save(buy);
  }

  async getBuy(id: number): Promise<Buy> {
    return this.buyRepo.findOne(id);
  }

  async getAllBuys(): Promise<Buy[]> {
    return this.buyRepo.find();
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
