import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Between, In, IsNull, Not } from 'typeorm';
import { Util } from 'src/shared/utils/util';
import { Lock } from 'src/shared/utils/lock';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { UpdateBuyCryptoDto } from '../dto/update-buy-crypto.dto';
import { Interval } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCryptoBatchService } from './buy-crypto-batch.service';
import { BuyCryptoOutService } from './buy-crypto-out.service';
import { BuyCryptoDexService } from './buy-crypto-dex.service';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { AmlCheck } from '../enums/aml-check.enum';
import { CryptoInput } from 'src/mix/models/crypto-input/crypto-input.entity';
import { CryptoRoute } from 'src/mix/models/crypto-route/crypto-route.entity';
import { CryptoRouteService } from 'src/mix/models/crypto-route/crypto-route.service';
import { CryptoHistoryDto } from 'src/mix/models/crypto-route/dto/crypto-history.dto';
import { HistoryDto } from 'src/subdomains/core/history/dto/history.dto';
import { Buy } from '../../route/buy.entity';
import { BuyRepository } from '../../route/buy.repository';
import { BuyService } from '../../route/buy.service';
import { BuyHistoryDto } from '../../route/dto/buy-history.dto';
import { BankTxService } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.service';
import { PaymentWebhookState, WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';

@Injectable()
export class BuyCryptoService {
  private readonly lock = new Lock(1800);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly buyRepo: BuyRepository,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    @Inject(forwardRef(() => BankTxService))
    private readonly bankTxService: BankTxService,
    private readonly settingService: SettingService,
    private readonly buyService: BuyService,
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly buyCryptoBatchService: BuyCryptoBatchService,
    private readonly buyCryptoOutService: BuyCryptoOutService,
    private readonly buyCryptoDexService: BuyCryptoDexService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly userService: UserService,
    private readonly webhookService: WebhookService,
  ) {}

  async createFromFiat(bankTxId: number, buyId: number): Promise<BuyCrypto> {
    let entity = await this.buyCryptoRepo.findOne({ bankTx: { id: bankTxId } });
    if (entity) throw new ConflictException('There is already a buy crypto for the specified bank TX');

    entity = this.buyCryptoRepo.create();

    // bank tx
    entity.bankTx = await this.bankTxService.getBankTxRepo().findOne(bankTxId);
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
      relations: [
        'buy',
        'buy.user',
        'buy.user.userData',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.userData',
        'bankTx',
      ],
    });
    if (!entity) throw new NotFoundException('Buy crypto not found');

    const buyIdBefore = entity.buy?.id;
    const cryptoRouteIdBefore = entity.cryptoRoute?.id;
    const usedRefBefore = entity.usedRef;

    const update = this.buyCryptoRepo.create(dto);

    // chargeback bank tx
    if (dto.chargebackBankTxId) {
      update.chargebackBankTx = await this.bankTxService.getBankTxRepo().findOne({ id: dto.chargebackBankTxId });
      if (!update.chargebackBankTx) throw new BadRequestException('Bank TX not found');
    }

    // buy
    if (dto.buyId) {
      if (!entity.buy) throw new BadRequestException(`Cannot assign BuyCrypto ${id} to a buy route`);
      update.buy = await this.getBuy(dto.buyId);
      if (entity.bankTx) await this.bankTxService.getBankTxRepo().setNewUpdateTime(entity.bankTx.id);
    }

    // crypto route
    if (dto.cryptoRouteId) {
      if (!entity.cryptoRoute) throw new BadRequestException(`Cannot assign BuyCrypto ${id} to a crypto route`);
      update.cryptoRoute = await this.getCryptoRoute(dto.cryptoRouteId);
      if (entity.bankTx) await this.bankTxService.getBankTxRepo().setNewUpdateTime(entity.bankTx.id);
    }

    Util.removeNullFields(entity);

    const amlUpdate =
      entity.amlCheck === AmlCheck.PENDING && update.amlCheck && update.amlCheck !== AmlCheck.PENDING
        ? { amlCheck: update.amlCheck, mailSendDate: null }
        : undefined;
    entity = await this.buyCryptoRepo.save(Object.assign(new BuyCrypto(), { ...update, ...entity, ...amlUpdate }));

    // activate user
    if (entity.amlCheck === AmlCheck.PASS) {
      await this.userService.activateUser(entity.buy?.user);
    }

    // payment webhook
    if (dto.inputAmount && dto.inputAsset) {
      entity.buy
        ? await this.webhookService.fiatCryptoUpdate(entity.user.userData, entity, PaymentWebhookState.CREATED)
        : await this.webhookService.cryptoCryptoUpdate(entity.user.userData, entity, PaymentWebhookState.CREATED);
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
      where: [
        { buy: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
        { cryptoRoute: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
      ],
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
    });
  }

  async getRefTransactions(
    refCodes: string[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes), outputDate: Between(dateFrom, dateTo) },
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
    });
  }

  async getBuyHistory(userId: number, buyId?: number): Promise<BuyHistoryDto[]> {
    const where = { user: { id: userId }, id: buyId };
    Util.removeNullFields(where);
    return this.buyCryptoRepo
      .find({
        where: { buy: where },
        relations: ['buy', 'buy.user'],
      })
      .then((buyCryptos) => buyCryptos.map(this.toHistoryDto));
  }

  async getCryptoHistory(userId: number, routeId?: number): Promise<CryptoHistoryDto[]> {
    const where = { user: { id: userId }, id: routeId };
    Util.removeNullFields(where);
    return this.buyCryptoRepo
      .find({
        where: { cryptoRoute: where },
        relations: ['cryptoRoute', 'cryptoRoute.user'],
      })
      .then((history) => history.map(this.toHistoryDto));
  }

  // --- HELPER METHODS --- //

  private toHistoryDto(buyCrypto: BuyCrypto): HistoryDto {
    return {
      inputAmount: buyCrypto.inputAmount,
      inputAsset: buyCrypto.inputAsset,
      amlCheck: buyCrypto.amlCheck,
      outputAmount: buyCrypto.outputAmount,
      outputAsset: buyCrypto.outputAsset?.dexName,
      txId: buyCrypto.txId,
      isComplete: buyCrypto.isComplete,
      date: buyCrypto.outputDate,
    };
  }

  private async getBuy(buyId: number): Promise<Buy> {
    // buy
    const buy = await this.buyRepo.findOne({ where: { id: buyId }, relations: ['user', 'user.userData'] });
    if (!buy) throw new BadRequestException('Buy route not found');

    return buy;
  }

  private async getCryptoRoute(cryptoRouteId: number): Promise<CryptoRoute> {
    // cryptoRoute
    const cryptoRoute = await this.cryptoRouteService
      .getCryptoRouteRepo()
      .findOne({ where: { id: cryptoRouteId }, relations: ['user', 'userData'] });
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
      const { volume: buyCryptoVolume, credit: buyCryptoCredit } = await this.getRefVolume(ref);
      const { volume: buyFiatVolume, credit: buyFiatCredit } = await this.buyFiatService.getRefVolume(ref);

      await this.userService.updateRefVolume(ref, buyCryptoVolume + buyFiatVolume, buyCryptoCredit + buyFiatCredit);
    }
  }

  async getRefVolume(ref: string): Promise<{ volume: number; credit: number }> {
    const { volume, credit } = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('SUM(amountInEur * refFactor)', 'volume')
      .addSelect('SUM(amountInEur * refFactor * refProvision * 0.01)', 'credit')
      .where('usedRef = :ref', { ref })
      .andWhere('amlCheck = :check', { check: AmlCheck.PASS })
      .getRawOne<{ volume: number; credit: number }>();

    return { volume: volume ?? 0, credit: credit ?? 0 };
  }

  // Admin Support Tool methods

  async getAllRefTransactions(refCodes: string[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: { usedRef: In(refCodes) },
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
    });
  }

  async getAllUserTransactions(userIds: number[]): Promise<BuyCrypto[]> {
    return await this.buyCryptoRepo.find({
      where: [{ buy: { user: { id: In(userIds) } } }, { cryptoRoute: { user: { id: In(userIds) } } }],
      relations: ['bankTx', 'buy', 'buy.user', 'cryptoInput', 'cryptoRoute', 'cryptoRoute.user'],
    });
  }

  // Statistics

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    // TODO Add cryptoInput buyCryptos, consultation with Daniel regarding statistic data
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
