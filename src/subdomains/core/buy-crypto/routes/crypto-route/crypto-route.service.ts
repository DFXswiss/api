import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { KycCompleted } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { IsNull, Not } from 'typeorm';
import { User, UserStatus } from '../../../../generic/user/models/user/user.entity';
import { DepositService } from '../../../../supporting/address-pool/deposit/deposit.service';
import { CryptoRoute } from './crypto-route.entity';
import { CryptoRouteRepository } from './crypto-route.repository';
import { CreateCryptoRouteDto } from './dto/create-crypto-route.dto';
import { UpdateCryptoRouteDto } from './dto/update-crypto-route.dto';

@Injectable()
export class CryptoRouteService {
  constructor(
    private readonly cryptoRepo: CryptoRouteRepository,
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
  @Lock()
  async resetAnnualVolumes(): Promise<void> {
    await this.cryptoRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
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
  async get(userId: number, id: number): Promise<CryptoRoute> {
    return this.cryptoRepo.findOneBy({ id, user: { id: userId } });
  }

  async createCrypto(userId: number, dto: CreateCryptoRouteDto, ignoreExisting = false): Promise<CryptoRoute> {
    // KYC check
    const { kycStatus } = await this.userDataService.getUserDataByUser(userId);
    if (!KycCompleted(kycStatus)) throw new BadRequestException('Missing KYC');

    const user = await this.userService.getUser(userId);
    if (user.status !== UserStatus.ACTIVE) throw new BadRequestException('Missing bank transaction');

    // check if exists
    const existing = await this.cryptoRepo.findOne({
      where: {
        asset: { id: dto.targetAsset.id },
        targetDeposit: IsNull(),
        user: { id: userId },
        deposit: { blockchain: dto.blockchain },
      },
      relations: ['deposit'],
    });

    if (existing) {
      if (existing.active && !ignoreExisting) throw new ConflictException('Crypto route already exists');

      if (!existing.active) {
        // reactivate deleted route
        existing.active = true;
        await this.cryptoRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const crypto = this.cryptoRepo.create(dto);
    crypto.user = { id: userId } as User;
    crypto.deposit = await this.depositService.getNextDeposit(dto.blockchain);

    // save
    return this.cryptoRepo.save(crypto);
  }

  async getUserCryptos(userId: number): Promise<CryptoRoute[]> {
    return this.cryptoRepo.findBy({ user: { id: userId } });
  }

  async updateCrypto(userId: number, cryptoId: number, dto: UpdateCryptoRouteDto): Promise<CryptoRoute> {
    const crypto = await this.cryptoRepo.findOneBy({ id: cryptoId, user: { id: userId } });
    if (!crypto) throw new NotFoundException('Crypto route not found');

    return this.cryptoRepo.save({ ...crypto, ...dto });
  }

  //*** GETTERS ***//

  getCryptoRouteRepo(): CryptoRouteRepository {
    return this.cryptoRepo;
  }
}
