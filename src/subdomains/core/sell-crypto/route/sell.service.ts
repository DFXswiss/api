import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CreateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/create-sell.dto';
import { UpdateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/update-sell.dto';
import { SellRepository } from 'src/subdomains/core/sell-crypto/route/sell.repository';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { In, Not } from 'typeorm';
import { DepositService } from '../../../supporting/address-pool/deposit/deposit.service';
import { BankAccountService } from '../../../supporting/bank/bank-account/bank-account.service';
import { ConfirmSellDto } from './dto/confirm-sell.dto';
import { Sell } from './sell.entity';

@Injectable()
export class SellService {
  constructor(
    private readonly sellRepo: SellRepository,
    private readonly depositService: DepositService,
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly bankAccountService: BankAccountService,
    private readonly assetService: AssetService,
    private readonly evmRegistry: EvmRegistryService,
  ) {}

  // --- SELLS --- //
  async get(userId: number, id: number): Promise<Sell> {
    return this.sellRepo.findOne({ where: { id, user: { id: userId } }, relations: { user: true } });
  }

  async getSellByKey(key: string, value: any): Promise<Sell> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('sell')
      .leftJoinAndSelect('sell.deposit', 'deposit')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `sell.${key}`} = :param`, { param: value })
      .getOne();
  }

  async getUserSells(userId: number): Promise<Sell[]> {
    const sellableBlockchains = await this.assetService.getSellableBlockchains();
    return this.sellRepo.find({
      where: {
        user: { id: userId },
        fiat: { buyable: true },
        deposit: { blockchain: In(sellableBlockchains) },
      },
      relations: { user: true },
    });
  }

  async createSell(userId: number, dto: CreateSellDto, ignoreExisting = false): Promise<Sell> {
    // check user data
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (!userData.isDataComplete) throw new BadRequestException('Ident data incomplete');

    // check if exists
    const existing = await this.sellRepo.findOne({
      where: {
        iban: dto.iban,
        fiat: { id: dto.currency.id },
        deposit: { blockchain: dto.blockchain },
        user: { id: userId },
      },
      relations: ['deposit', 'user'],
    });

    if (existing) {
      if (existing.active && !ignoreExisting) throw new ConflictException('Sell route already exists');

      if (!existing.active) {
        // reactivate deleted route
        existing.active = true;
        await this.sellRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const sell = this.sellRepo.create(dto);
    sell.user = await this.userService.getUser(userId, { userData: true });
    sell.fiat = dto.currency;
    sell.deposit = await this.depositService.getNextDeposit(dto.blockchain);
    sell.bankAccount = await this.bankAccountService.getOrCreateBankAccount(dto.iban, userId);

    return this.sellRepo.save(sell);
  }

  async updateSell(userId: number, sellId: number, dto: UpdateSellDto): Promise<Sell> {
    const sell = await this.sellRepo.findOne({
      where: { id: sellId, user: { id: userId } },
      relations: { user: true },
    });
    if (!sell) throw new NotFoundException('Sell route not found');

    return this.sellRepo.save({ ...sell, ...dto });
  }

  async count(): Promise<number> {
    return this.sellRepo.count();
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  @Lock()
  async resetAnnualVolumes(): Promise<void> {
    await this.sellRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(sellId: number, volume: number, annualVolume: number): Promise<void> {
    await this.sellRepo.update(sellId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.sellRepo.findOne({
      where: { id: sellId },
      relations: ['user'],
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateSellVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  // --- CONFIRMATION --- //
  async confirmSell(request: TransactionRequest, dto: ConfirmSellDto): Promise<Transaction> {
    const asset = await this.assetService.getAssetById(request.sourceId);
    const client = this.evmRegistry.getClient(asset.blockchain);

    const txId = await client.permitTransfer(
      dto.permit.address,
      dto.permit.signature,
      dto.permit.signatureTransferContract,
      asset,
      request.amount,
      request.amount,
      dto.permit.nonce,
      dto.permit.deadline,
    );
    console.log(txId);

    // TODO: create crypto input

    throw new Error('Method not implemented.');
  }
}
