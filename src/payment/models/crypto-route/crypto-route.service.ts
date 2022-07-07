import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, Not } from 'typeorm';
import { User } from '../../../user/models/user/user.entity';
import { Util } from 'src/shared/util';
import { StakingService } from '../staking/staking.service';
import { UserService } from 'src/user/models/user/user.service';
import { Config } from 'src/config/config';
import { CryptoRouteRepository } from './crypto-route.repository';
import { BuyType } from '../buy/dto/buy-type.enum';
import { UpdateCryptoRouteDto } from './dto/update-crypto-route.dto';
import { CreateCryptoRouteDto } from './dto/create-crypto-route.dto';
import { CryptoRoute } from './crypto-route.entity';
import { DepositService } from '../deposit/deposit.service';

@Injectable()
export class CryptoRouteService {
  constructor(
    private readonly cryptoRouteRepo: CryptoRouteRepository,
    private readonly assetService: AssetService,
    private readonly stakingService: StakingService,
    private readonly userService: UserService,
    private readonly depositService: DepositService,
  ) {}

  async getCryptoByAddress(depositAddress: string): Promise<CryptoRoute> {
    // does not work with find options
    return this.cryptoRouteRepo
      .createQueryBuilder('crypto')
      .leftJoinAndSelect('crypto.deposit', 'deposit')
      .leftJoinAndSelect('crypto.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    this.cryptoRouteRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(cryptoId: number, volume: number, annualVolume: number): Promise<void> {
    await this.cryptoRouteRepo.update(cryptoId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.cryptoRouteRepo.findOne({
      where: { id: cryptoId },
      relations: ['user'],
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateCryptoVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.cryptoRouteRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.cryptoRouteRepo
      .createQueryBuilder('crypto')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  // --- CRYPTOS --- //
  async createCrypto(userId: number, dto: CreateCryptoRouteDto): Promise<CryptoRoute> {
    // check asset
    const asset =
      dto.buyType === BuyType.WALLET
        ? await this.assetService.getAsset(dto.asset.id)
        : await this.assetService.getAssetByDexName('DFI');
    if (!asset) throw new BadRequestException('Asset not found');

    // check staking
    const staking =
      dto.buyType === BuyType.STAKING ? await this.stakingService.getStaking(dto.targetDeposit.id, userId) : null;
    if (dto.buyType === BuyType.STAKING && !staking) throw new BadRequestException('Staking route not found');

    // check if exists
    const existing = await this.cryptoRouteRepo.findOne({
      where: {
        ...(dto.buyType === BuyType.WALLET
          ? { asset: asset, targetDeposit: IsNull() }
          : { targetDeposit: staking?.deposit }),
        user: { id: userId },
        deposit: { blockchain: dto.blockchain },
      },
      relations: ['deposit'],
    });
    if (existing) throw new ConflictException('Crypto route already exists');

    // create the entity
    const crypto = this.cryptoRouteRepo.create(dto);
    crypto.user = { id: userId } as User;
    crypto.asset = asset;
    crypto.targetDeposit = staking?.deposit ?? null;
    crypto.deposit = await this.depositService.getNextDeposit(dto.blockchain);

    // save
    return this.cryptoRouteRepo.save(crypto);
  }

  async getUserCryptos(userId: number): Promise<CryptoRoute[]> {
    return this.cryptoRouteRepo.find({ user: { id: userId } });
  }

  async updateCrypto(userId: number, cryptoId: number, dto: UpdateCryptoRouteDto): Promise<CryptoRoute> {
    const crypto = await this.cryptoRouteRepo.findOne({ id: cryptoId, user: { id: userId } });
    if (!crypto) throw new NotFoundException('Crypto route not found');

    return await this.cryptoRouteRepo.save({ ...crypto, ...dto });
  }
}
