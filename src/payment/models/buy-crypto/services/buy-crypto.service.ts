import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from '../../buy/buy.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../../bank-tx/bank-tx.repository';
import { Between, In, IsNull, Not } from 'typeorm';
import { BuyRepository } from '../../buy/buy.repository';
import { Util } from 'src/shared/util';
import { Lock } from 'src/shared/lock';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { UpdateBuyCryptoDto } from '../dto/update-buy-crypto.dto';
import { Buy } from '../../buy/buy.entity';
import { Interval } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCryptoBatchService } from './buy-crypto-batch.service';
import { BuyCryptoOutService } from './buy-crypto-out.service';
import { BuyCryptoDexService } from './buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { AmlCheck } from '../enums/aml-check.enum';
import { CryptoRouteRepository } from '../../crypto-route/crypto-route.repository';
import { CryptoRoute } from '../../crypto-route/crypto-route.entity';
import { CryptoRouteService } from '../../crypto-route/crypto-route.service';
import { CryptoInput } from '../../crypto-input/crypto-input.entity';
import { BuyCryptoHistoryDto } from '../dto/buy-crypto-history.dto';

@Injectable()
export class BuyCryptoService {
  private readonly lock = new Lock(1800);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly bankTxRepo: BankTxRepository,
    private readonly cryptoRouteRepo: CryptoRouteRepository,
    private readonly buyRepo: BuyRepository,
    private readonly settingService: SettingService,
    private readonly buyService: BuyService,
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly buyCryptoBatchService: BuyCryptoBatchService,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly buyCryptoDexService: BuyCryptoDexService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly userService: UserService,
  ) {}

  async createFromFiat(bankTxId: number, buyId: number): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({ bankTx: { id: bankTxId } });
    if (entity) throw new ConflictException('There is already a buy crypto for the specified bank TX');

    entity = this.buyCryptoRepo.create();

    // bank tx
    entity.bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!entity.bankTx) throw new BadRequestException('Bank TX not found');

    // buy
    if (buyId) entity.buy = await this.getBuy(buyId);

    return await this.buyCryptoRepo.save(entity);
  }

  async createFromCrypto(cryptoInput: CryptoInput): Promise<BuyCrypto> {
    const entity = this.buyCryptoRepo.create();

    entity.cryptoInput = cryptoInput;
    entity.cryptoRoute = cryptoInput.route as CryptoRoute;

    return await this.buyCryptoRepo.save(entity);
  }

  async update(id: number, dto: UpdateBuyCryptoDto): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne(id, {
      relations: ['buy', 'buy.user', 'cryptoRoute', 'cryptoRoute.user'],
    });
    if (!entity) throw new NotFoundException('Buy crypto not found');

    const buyIdBefore = entity.buy?.id;
    const cryptoRouteIdBefore = entity.cryptoRoute?.id;
    const usedRefBefore = entity.usedRef;

    const update = this.buyCryptoRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId) {
      update.chargebackBankTx = await this.bankTxRepo.findOne({ id: dto.chargebackBankTxId });
      if (!update.chargebackBankTx) throw new BadRequestException('Bank TX not found');
    }

    // buy
    if (dto.buyId) {
      if (!entity.buy) throw new BadRequestException(`Cannot assign BuyCrypto ${id} to a buy route`);
      update.buy = await this.getBuy(dto.buyId);
    }

    // crypto route
    if (dto.cryptoRouteId) {
      if (!entity.cryptoRoute) throw new BadRequestException(`Cannot assign BuyCrypto ${id} to a crypto route`);
      update.cryptoRoute = await this.getCryptoRoute(dto.cryptoRouteId);
    }

    Util.removeNullFields(entity);

    entity = await this.buyCryptoRepo.save({ ...update, ...entity });

    // activate user
    if (entity.amlCheck === AmlCheck.PASS) {
      await this.userService.activateUser(entity.buy?.user);
    }

    await this.updateBuyVolume([buyIdBefore, entity.buy?.id]);
    await this.updateCryptoRouteVolume([cryptoRouteIdBefore, entity.cryptoRoute?.id]);
    await this.updateRefVolume([usedRefBefore, entity.usedRef]);

    return entity;
  }

  @Interval(60000)
  async process() {
    if ((await this.settingService.get('buy-process')) !== 'on') return;
    if (!this.lock.acquire()) return;

    await this.buyCryptoBatchService.batchTransactionsByAssets();
    await this.buyCryptoDexService.secureLiquidity();
    await this.buyCryptoDexService.transferLiquidityForOutput();
    await this.buyCryptoOutService.payoutTransactions();
    await this.buyCryptoNotificationService.sendNotificationMails();

    this.lock.release();
  }

  async updateVolumes(): Promise<void> {
    const buyIds = await this.buyRepo.find().then((l) => l.map((b) => b.id));
    await this.updateBuyVolume(buyIds);
  }

  async updateRefVolumes(): Promise<void> {
    const refs = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('usedRef')
      .groupBy('usedRef')
      .getRawMany<{ usedRef: string }>();
    await this.updateRefVolume(refs.map((r) => r.usedRef));
  }

  async getUserTransactions(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { buy: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { buy: { user: { id: In(userIds) } } },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getRefTransactions(
    refCodes: string[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes), outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getAllRefTransactions(refCodes: string[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes) },
      relations: ['bankTx', 'buy', 'buy.user'],
    });
  }

  async getHistory(userId: number, buyId: number): Promise<BuyCryptoHistoryDto[]> {
    return this.buyCryptoRepo
      .find({
        where: { buy: { id: buyId, user: { id: userId } } },
        relations: ['buy', 'buy.user'],
      })
      .then((buyCryptos) => buyCryptos.map(this.toHistoryDto));
  }

  // --- HELPER METHODS --- //

  private toHistoryDto(buyCrypto: BuyCrypto): BuyCryptoHistoryDto {
    return {
      inputAmount: buyCrypto.inputAmount,
      inputAsset: buyCrypto.inputAsset,
      amlCheck: buyCrypto.amlCheck,
      outputAmount: buyCrypto.outputAmount,
      outputAsset: buyCrypto.outputAsset,
      txId: buyCrypto.txId,
      isComplete: buyCrypto.isComplete,
      date: buyCrypto.outputDate,
    };
  }

  private async getBuy(buyId: number): Promise<Buy> {
    // buy
    const buy = await this.buyRepo.findOne({ where: { id: buyId }, relations: ['user'] });
    if (!buy) throw new BadRequestException('Buy route not found');

    return buy;
  }

  private async getCryptoRoute(cryptoRouteId: number): Promise<CryptoRoute> {
    // cryptoRoute
    const cryptoRoute = await this.cryptoRouteRepo.findOne({ where: { id: cryptoRouteId }, relations: ['user'] });
    if (!cryptoRoute) throw new BadRequestException('Crypto route not found');

    return cryptoRoute;
  }

  private async updateBuyVolume(buyIds: number[]): Promise<void> {
    buyIds = buyIds.filter((u, j) => buyIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of buyIds) {
      const { volume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'volume')
        .where('buyId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'annualVolume')
        .leftJoin('buyCrypto.bankTx', 'bankTx')
        .where('buyCrypto.buyId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('bankTx.bookingDate >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.buyService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  private async updateCryptoRouteVolume(cryptoRouteIds: number[]): Promise<void> {
    cryptoRouteIds = cryptoRouteIds.filter((u, j) => cryptoRouteIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of cryptoRouteIds) {
      const { volume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'volume')
        .where('cryptoRouteId = :id', { id: id })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number }>();

      const newYear = new Date(new Date().getFullYear(), 0, 1);
      const { annualVolume } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur)', 'annualVolume')
        .leftJoin('buyCrypto.cryptoInput', 'cryptoInput')
        .where('buyCrypto.cryptoRouteId = :id', { id: id })
        .andWhere('buyCrypto.amlCheck = :check', { check: AmlCheck.PASS })
        .andWhere('cryptoInput.created >= :year', { year: newYear })
        .getRawOne<{ annualVolume: number }>();

      await this.cryptoRouteService.updateVolume(id, volume ?? 0, annualVolume ?? 0);
    }
  }

  private async updateRefVolume(refs: string[]): Promise<void> {
    refs = refs.filter((u, j) => refs.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const ref of refs) {
      const { volume, credit } = await this.buyCryptoRepo
        .createQueryBuilder('buyCrypto')
        .select('SUM(amountInEur * refFactor)', 'volume')
        .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
        .where('usedRef = :ref', { ref })
        .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
        .getRawOne<{ volume: number; credit: number }>();

      await this.userService.updateRefVolume(ref, volume ?? 0, credit ?? 0);
    }
  }

  // Statistics

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const buyCryptos = await this.buyCryptoRepo.find({
      where: { buy: { id: Not(IsNull()) }, outputDate: Between(dateFrom, dateTo), amlCheck: AmlCheck.PASS },
      relations: ['buy'],
    });

    return buyCryptos.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.buy?.asset?.name,
    }));
  }
}
