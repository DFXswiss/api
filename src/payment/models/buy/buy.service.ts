import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBuyDto } from 'src/payment/models/buy/dto/create-buy.dto';
import { BuyRepository } from 'src/payment/models/buy/buy.repository';
import { UpdateBuyDto } from './dto/update-buy.dto';
import { Buy } from './buy.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, Not } from 'typeorm';
import { User } from '../../../user/models/user/user.entity';
import { Util } from 'src/shared/util';
import { StakingService } from '../staking/staking.service';
import { BuyType } from './dto/buy-type.enum';
import { UserService } from 'src/user/models/user/user.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { Config } from 'src/config/config';
import { CreateBuyPaymentInfoDto } from './dto/create-buy-payment-info.dto';
import { Bank } from './dto/buy-payment-info.dto';

@Injectable()
export class BuyService {
  constructor(
    private readonly buyRepo: BuyRepository,
    private readonly assetService: AssetService,
    private readonly stakingService: StakingService,
    private readonly userService: UserService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    this.buyRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
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

  // --- PAYMENT-INFO --- //
  async getBuyPaymentInfos(
    userId: number,
    userAddress: string,
    dto: CreateBuyPaymentInfoDto,
  ): Promise<{ buy: Buy; bank: Bank }> {
    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    let buy = await this.buyRepo.findOne({
      where: { iban: dto.iban, asset: dto.asset, user: { id: userId }, deposit: IsNull() },
      relations: ['bankAccount'],
    });
    if (!buy)
      buy = await this.createBuyInternal(userId, userAddress, {
        ...dto,
        type: BuyType.WALLET,
        staking: null,
      });

    // reactivate deleted route
    if (!buy.active) {
      buy.active = true;
      this.buyRepo.save(buy);
    }

    return {
      buy: buy,
      bank: dto.currency.name === 'EUR' && buy.bankAccount.sctInst ? Bank.OLKY : Bank.MAERKI,
    };
  }

  // --- BUYS --- //
  async createBuy(userId: number, userAddress: string, dto: CreateBuyDto): Promise<Buy> {
    // check if exists
    const existing = await this.buyRepo.findOne({
      where: {
        iban: dto.iban,
        ...(dto.type === BuyType.WALLET ? { asset: dto.asset, deposit: IsNull() } : { deposit: dto.staking?.deposit }),
        user: { id: userId },
      },
      relations: ['deposit'],
    });

    if (existing) {
      if (existing.active) throw new ConflictException('Buy route already exists');

      // reactivate deleted route
      existing.active = true;
      return this.buyRepo.save(existing);
    }

    return await this.createBuyInternal(userId, userAddress, dto);
  }

  async getUserBuys(userId: number): Promise<Buy[]> {
    return this.buyRepo.find({ user: { id: userId } });
  }

  async updateBuy(userId: number, buyId: number, dto: UpdateBuyDto): Promise<Buy> {
    const buy = await this.buyRepo.findOne({ id: buyId, user: { id: userId } });
    if (!buy) throw new NotFoundException('Buy route not found');

    return await this.buyRepo.save({ ...buy, ...dto });
  }

  // --- HELPER-METHODS --- //
  private async createBuyInternal(userId: number, userAddress: string, dto: CreateBuyDto): Promise<Buy> {
    // check asset
    const asset =
      dto.type === BuyType.WALLET
        ? await this.assetService.getAsset(dto.asset.id)
        : await this.assetService.getAssetByDexName('DFI');
    if (!asset) throw new BadRequestException('Asset not found');

    // check staking
    const staking = dto.type === BuyType.STAKING ? await this.stakingService.getStaking(dto.staking.id, userId) : null;
    if (dto.type === BuyType.STAKING && !staking) throw new BadRequestException('Staking route not found');

    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = { id: userId } as User;
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
}
