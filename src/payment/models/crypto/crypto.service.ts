import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, Not } from 'typeorm';
import { User } from '../../../user/models/user/user.entity';
import { Util } from 'src/shared/util';
import { StakingService } from '../staking/staking.service';
import { UserService } from 'src/user/models/user/user.service';
import { Config } from 'src/config/config';
import { CryptoRepository } from './crypto.repository';
import { BuyType } from '../buy/dto/buy-type.enum';
import { UpdateCryptoDto } from './dto/update-crypto.dto';
import { CreateCryptoDto } from './dto/create-crypto.dto';
import { Crypto } from './crypto-route.entity';

@Injectable()
export class CryptoService {
  constructor(
    private readonly cryptoRepo: CryptoRepository,
    private readonly assetService: AssetService,
    private readonly stakingService: StakingService,
    private readonly userService: UserService,
  ) {}

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    this.cryptoRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(cryptoId: number, volume: number, annualVolume: number): Promise<void> {
    await this.cryptoRepo.update(cryptoId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.cryptoRepo.findOne({
      where: { id: cryptoId },
      relations: ['user'],
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateCryptoVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.cryptoRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.cryptoRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  // --- CRYPTOS --- //
  async createCrypto(userId: number, dto: CreateCryptoDto): Promise<Crypto> {
    // check asset
    const asset =
      dto.buyType === BuyType.WALLET
        ? await this.assetService.getAsset(dto.asset.id)
        : await this.assetService.getAssetByDexName('DFI');
    if (!asset) throw new BadRequestException('Asset not found');

    // check staking
    const staking =
      dto.buyType === BuyType.STAKING ? await this.stakingService.getStaking(dto.staking.id, userId) : null;
    if (dto.buyType === BuyType.STAKING && !staking) throw new BadRequestException('Staking route not found');

    // check if exists
    const existing = await this.cryptoRepo.findOne({
      where: {
        asset: dto.asset,
        ...(dto.buyType === BuyType.WALLET ? { asset: asset, deposit: IsNull() } : { deposit: staking?.deposit }),
        user: { id: userId },
      },
      relations: ['deposit'],
    });
    if (existing) throw new ConflictException('Buy route already exists');

    // create the entity
    const crypto = this.cryptoRepo.create(dto);
    crypto.user = { id: userId } as User;
    crypto.asset = asset;
    crypto.deposit = staking?.deposit ?? null;

    // save
    return this.cryptoRepo.save(crypto);
  }

  async getUserCryptos(userId: number): Promise<Crypto[]> {
    return this.cryptoRepo.find({ user: { id: userId } });
  }

  async updateCrypto(userId: number, cryptoId: number, dto: UpdateCryptoDto): Promise<Crypto> {
    const crypto = await this.cryptoRepo.findOne({ id: cryptoId, user: { id: userId } });
    if (!crypto) throw new NotFoundException('Crypto route not found');

    return await this.cryptoRepo.save({ ...crypto, ...dto });
  }

  async count(): Promise<number> {
    return this.cryptoRepo.count();
  }
}
