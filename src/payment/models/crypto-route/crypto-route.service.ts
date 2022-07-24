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
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { KycCompleted } from 'src/user/models/user-data/user-data.entity';

@Injectable()
export class CryptoRouteService {
  constructor(
    private readonly cryptoRepo: CryptoRouteRepository,
    private readonly assetService: AssetService,
    private readonly stakingService: StakingService,
    private readonly userService: UserService,
    private readonly depositService: DepositService,
    private readonly userDataService: UserDataService,
  ) {}

  async getCryptoRouteByAddress(depositAddress: string): Promise<CryptoRoute> {
    // does not work with find options
    return this.cryptoRepo
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
  async createCrypto(userId: number, dto: CreateCryptoRouteDto): Promise<CryptoRoute> {
    // KYC check
    const { kycStatus } = await this.userDataService.getUserDataByUser(userId);
    if (!KycCompleted(kycStatus)) throw new BadRequestException('Missing KYC');

    // check asset
    const asset =
      dto.type === BuyType.WALLET
        ? await this.assetService.getAsset(dto.asset.id)
        : await this.assetService.getAssetByDexName('DFI');
    if (!asset) throw new BadRequestException('Asset not found');

    // check staking
    const staking = dto.type === BuyType.STAKING ? await this.stakingService.getStaking(dto.staking.id, userId) : null;
    if (dto.type === BuyType.STAKING && !staking) throw new BadRequestException('Staking route not found');

    // check if exists
    const existing = await this.cryptoRepo.findOne({
      where: {
        ...(dto.type === BuyType.WALLET
          ? { asset: asset, targetDeposit: IsNull() }
          : { targetDeposit: staking.deposit }),
        user: { id: userId },
        deposit: { blockchain: dto.blockchain },
      },
      relations: ['deposit'],
    });
    if (existing) throw new ConflictException('Crypto route already exists');

    // create the entity
    const crypto = this.cryptoRepo.create();
    crypto.user = { id: userId } as User;
    crypto.asset = asset;
    crypto.targetDeposit = staking?.deposit ?? null;
    crypto.deposit = await this.depositService.getNextDeposit(dto.blockchain);

    // save
    return this.cryptoRepo.save(crypto);
  }

  async getUserCryptos(userId: number): Promise<CryptoRoute[]> {
    return this.cryptoRepo.find({ user: { id: userId } });
  }

  async updateCrypto(userId: number, cryptoId: number, dto: UpdateCryptoRouteDto): Promise<CryptoRoute> {
    const crypto = await this.cryptoRepo.findOne({ id: cryptoId, user: { id: userId } });
    if (!crypto) throw new NotFoundException('Crypto route not found');

    return await this.cryptoRepo.save({ ...crypto, ...dto });
  }
}
