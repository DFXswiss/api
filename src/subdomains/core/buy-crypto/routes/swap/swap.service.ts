import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoExtended } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { ConfirmDto } from 'src/subdomains/core/sell-crypto/route/dto/confirm.dto';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { IsNull, Like, Not } from 'typeorm';
import { DepositService } from '../../../../supporting/address-pool/deposit/deposit.service';
import { BuyCryptoWebhookService } from '../../process/services/buy-crypto-webhook.service';
import { BuyCryptoService } from '../../process/services/buy-crypto.service';
import { UpdateSwapDto } from './dto/update-swap.dto';
import { Swap } from './swap.entity';
import { SwapRepository } from './swap.repository';

@Injectable()
export class SwapService {
  private readonly logger = new DfxLogger(SwapService);

  constructor(
    private readonly swapRepo: SwapRepository,
    private readonly userService: UserService,
    private readonly depositService: DepositService,
    private readonly userDataService: UserDataService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    @Inject(forwardRef(() => TransactionUtilService))
    private readonly transactionUtilService: TransactionUtilService,
    private readonly routeService: RouteService,
  ) {}

  async getSwapByAddress(depositAddress: string): Promise<Swap> {
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
  @DfxCron(CronExpression.EVERY_YEAR)
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

  async getSwapWithoutRoute(): Promise<Swap[]> {
    return this.swapRepo.findBy({ route: { id: IsNull() } });
  }

  // --- SWAPS --- //
  async get(userId: number, id: number): Promise<Swap> {
    return this.swapRepo.findOne({ where: { id, user: { id: userId } }, relations: { user: true } });
  }

  async createSwap(userId: number, blockchain: Blockchain, asset: Asset, ignoreException = false): Promise<Swap> {
    // KYC check
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (userData.status !== UserDataStatus.ACTIVE && userData.kycLevel < KycLevel.LEVEL_30 && !ignoreException)
      throw new BadRequestException('User not allowed for swap trading');

    // check if exists
    const existing = await this.swapRepo.findOne({
      where: {
        asset: { id: asset.id },
        targetDeposit: IsNull(),
        user: { id: userId },
        deposit: { blockchains: Like(`%${blockchain}%`) },
      },
      relations: { deposit: true, user: true },
    });

    if (existing) {
      if (existing.active && !ignoreException) throw new ConflictException('Swap route already exists');

      if (!existing.active && (userData.status === UserDataStatus.ACTIVE || userData.kycLevel >= KycLevel.LEVEL_30)) {
        // reactivate deleted route
        existing.active = true;
        await this.swapRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const swap = this.swapRepo.create({ asset });
    swap.user = await this.userService.getUser(userId);
    swap.route = await this.routeService.createRoute({ swap });
    swap.deposit = await this.depositService.getNextDeposit(blockchain);

    // save
    return this.swapRepo.save(swap);
  }

  async getUserSwaps(userId: number): Promise<Swap[]> {
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (!userData.hasBankTxVerification) return [];

    return this.swapRepo.find({
      where: { user: { id: userId }, asset: { buyable: true }, active: true },
      relations: { user: true },
    });
  }

  async updateSwap(userId: number, swapId: number, dto: UpdateSwapDto): Promise<Swap> {
    const swap = await this.swapRepo.findOneBy({ id: swapId, user: { id: userId } });
    if (!swap) throw new NotFoundException('Swap route not found');

    return this.swapRepo.save({ ...swap, ...dto });
  }

  // --- CONFIRMATION --- //
  async confirmSwap(request: TransactionRequest, dto: ConfirmDto): Promise<BuyCryptoExtended> {
    try {
      const route = await this.swapRepo.findOne({
        where: { id: request.routeId },
        relations: { deposit: true, user: { wallet: true, userData: true } },
      });

      const payIn = await this.transactionUtilService.handlePermitInput(route, request, dto);
      const buyCrypto = await this.buyCryptoService.createFromCryptoInput(payIn, route, request);

      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_CRYPTO, route);

      return await this.buyCryptoWebhookService.extendBuyCrypto(buyCrypto);
    } catch (e) {
      this.logger.warn(`Failed to execute permit transfer for swap request ${request.id}:`, e);
      throw new BadRequestException(`Failed to execute permit transfer: ${e.message}`);
    }
  }

  //*** GETTERS ***//

  getSwapRepo(): SwapRepository {
    return this.swapRepo;
  }
}
